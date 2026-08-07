/**
 * Structural checks over supabase/migrations and seed.sql.
 *
 * This is NOT a substitute for `supabase db reset` — only Postgres can tell you the SQL is
 * correct. It exists because migrations are frequently written on machines without Docker,
 * and the failure mode there is discovering an unbalanced `$$` or a stray paren twenty
 * minutes into CI. Everything here is a syntax-shape check that can be done offline:
 *
 *   1. dollar-quote (`$$`, `$tag$`) balance
 *   2. parenthesis balance, ignoring comments, string literals and dollar-quoted bodies
 *   3. every statement terminated — the file must not end mid-statement
 *   4. duplicate policy names on the same table (Postgres rejects these at apply time)
 *   5. unique, ordered migration timestamps
 *   6. no `auth.uid()` called bare inside a policy predicate (docs/13 §D7 — must be
 *      wrapped as `(select auth.uid())` so the planner hoists it to an InitPlan)
 *   7. `language sql` functions that reference a table created in a LATER migration
 *
 * Check 7 exists because that bug actually reached the database. Postgres parses and
 * validates a SQL function's body at CREATE time — unlike plpgsql, which defers to first
 * call — so `has_any_role`, defined in migration 01 and querying `profiles` from
 * migration 02, failed with `relation "profiles" does not exist`. Nothing offline caught
 * it, and the whole push aborted on the first file.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const SEED = join(process.cwd(), 'supabase', 'seed.sql');
/** The demo catalogue, split out of seed.sql per `[db.seed] sql_paths` in config.toml. */
const SEEDS_DIR = join(process.cwd(), 'supabase', 'seeds');

const problems: string[] = [];
const note = (file: string, message: string) => problems.push(`${file}: ${message}`);

/** Strips comments, string literals and dollar-quoted bodies, preserving line numbers. */
function stripNoise(sql: string): {
  code: string;
  dollarBalanced: boolean;
  commentBalanced: boolean;
} {
  let out = '';
  let i = 0;
  let dollarTag: string | null = null;
  let balanced = true;
  let commentBalanced = true;

  while (i < sql.length) {
    const rest = sql.slice(i);

    if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        i += dollarTag.length;
        dollarTag = null;
      } else {
        if (sql[i] === '\n') out += '\n';
        i += 1;
      }
      continue;
    }

    const dollarOpen = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollarOpen) {
      dollarTag = dollarOpen[0];
      i += dollarOpen[0].length;
      continue;
    }

    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }

    /*
     * Block comments, tracked by depth, because Postgres nests them.
     *
     * Unlike C, JavaScript and almost everything else, an inner comment opener inside a block
     * comment starts a second level, and the next closer only returns to the first. Scanning
     * to the first closer — which is how a person reads it, and what this did until migration
     * 22 — makes an unterminated nested comment invisible here while it swallows every
     * statement after it in Postgres.
     *
     * docs/13 §T1: the cost was an hour and three wrong theories, and the symptom was
     * `db push` blaming "statement 0", i.e. the whole file.
     */
    if (rest.startsWith('/*')) {
      let depth = 0;
      const start = i;
      while (i < sql.length) {
        if (sql.startsWith('/*', i)) {
          depth += 1;
          i += 2;
        } else if (sql.startsWith('*/', i)) {
          depth -= 1;
          i += 2;
          if (depth === 0) break;
        } else {
          i += 1;
        }
      }
      if (depth > 0) commentBalanced = false;
      out += sql.slice(start, i).replace(/[^\n]/g, ' ');
      continue;
    }

    if (sql[i] === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        if (sql[i] === '\n') out += '\n';
        i += 1;
      }
      out += "''";
      continue;
    }

    if (sql[i] === '"') {
      // A double-quoted *identifier*, not a literal — pass it through verbatim so
      // duplicate-policy detection can still read the name.
      const end = sql.indexOf('"', i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    out += sql[i];
    i += 1;
  }

  if (dollarTag !== null) balanced = false;
  return { code: out, dollarBalanced: balanced, commentBalanced };
}

function checkFile(file: string, sql: string): void {
  const { code, dollarBalanced, commentBalanced } = stripNoise(sql);

  if (!dollarBalanced) {
    note(file, 'unterminated dollar-quoted block ($$ … $$)');
  }

  if (!commentBalanced) {
    note(file, 'unterminated block comment — remember /* nests in Postgres (docs/13 §T1)');
  }

  let depth = 0;
  let line = 1;
  for (const character of code) {
    if (character === '\n') line += 1;
    else if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth < 0) {
        note(file, `unbalanced ")" at line ${line}`);
        depth = 0;
      }
    }
  }
  if (depth > 0) note(file, `${depth} unclosed "(" at end of file`);

  const trailing = code.trimEnd();
  if (trailing.length > 0 && !trailing.endsWith(';')) {
    note(file, 'file does not end with a terminated statement (missing ";")');
  }

  // Duplicate policy names per table.
  const seen = new Map<string, number>();
  for (const match of code.matchAll(/create\s+policy\s+("?)([\w\- ]+)\1\s+on\s+([\w.]+)/gi)) {
    const key = `${match[3]?.toLowerCase()}.${match[2]?.toLowerCase()}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) note(file, `policy "${key}" declared ${count} times`);
  }

  // docs/13 §D7 — bare auth.uid() in a policy predicate re-evaluates per row.
  for (const match of code.matchAll(/create\s+policy[\s\S]*?(?=;)/gi)) {
    const body = match[0];
    if (
      /(?<!select\s)auth\.uid\(\)/i.test(body.replace(/\(\s*select\s+auth\.uid\(\)\s*\)/gi, 'OK'))
    ) {
      const name = /create\s+policy\s+("?)([\w\- ]+)\1\s+on\s+([\w.]+)/i.exec(body);
      note(
        file,
        `policy "${name?.[2] ?? '?'}" on ${name?.[3] ?? '?'} calls auth.uid() unwrapped — ` +
          'use (select auth.uid()) so it is hoisted to an InitPlan (docs/13 §D7)',
      );
    }
  }
}

/**
 * Bodies of `language sql` functions, paired with the function name.
 *
 * Located by scanning for `$$ … $$` blocks and looking back at the preceding text for a
 * `create function … language sql`. Cruder than parsing, but it does not need a SQL
 * grammar and it does not false-positive on plpgsql, whose bodies are validated lazily.
 */
function sqlFunctionBodies(sql: string): { name: string; body: string }[] {
  const found: { name: string; body: string }[] = [];
  const blocks = /\$\$([\s\S]*?)\$\$/g;

  for (const match of sql.matchAll(blocks)) {
    const start = match.index ?? 0;
    const prefix = sql.slice(Math.max(0, start - 400), start);
    if (!/\blanguage\s+sql\b/i.test(prefix)) continue;

    const name = /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)/i.exec(prefix);
    if (!name?.[1]) continue;
    found.push({ name: name[1], body: match[1] ?? '' });
  }
  return found;
}

/**
 * Comments removed, so prose is never mistaken for code.
 *
 * Without this, a function body explaining that "the tail comes **from the** shopper" reports a missing
 * table called `the`. Comments in these files carry most of the reasoning, so they are long and they are
 * full of the word "from".
 */
function stripComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** Table names a function body reads from, minus CTEs, function calls and non-application schemas. */
function referencedTables(rawBody: string): string[] {
  const body = stripComments(rawBody);

  /*
   * CTE names, so a `with` clause is not mistaken for a table that does not exist.
   *
   * The pattern used to be `\b(?:with|,)\s+…`, and the `\b` was wrong for the comma branch: a
   * chained CTE is written `… ), biocode as (`, where the character before the comma is `)`. Both
   * `)` and `,` are non-word characters, so there is no boundary between them and the alternative
   * never matched — only the **first** CTE in a chain was recognised, and every later one was
   * reported as a missing table. `variant_buy_box` (migration 32) has four, and three were flagged.
   *
   * `\s*` rather than `\s+` after the comma for the same reason: `,biocode as (` is legal SQL.
   *
   * `(?:not\s+)?materialized` because `with q as not materialized (` is how you force the planner to
   * inline a CTE referenced more than once — which `search_products` needs, or its trigram predicates
   * stop matching their indexes. Without this branch the CTE went unrecognised and was reported as a
   * missing table.
   */
  const ctes = new Set(
    [
      ...body.matchAll(
        /(?:\bwith\b(?:\s+recursive\b)?|,)\s*([a-z_]\w*)\s+as\s*(?:(?:not\s+)?materialized\s*)?\(/gi,
      ),
    ].map((m) => (m[1] ?? '').toLowerCase()),
  );

  const tables = new Set<string>();
  /*
   * `(?!\s*\()` skips set-returning functions in the FROM list — `from unnest(...)`,
   * `from generate_series(...)`, `from jsonb_array_elements(...)`. A table is never followed by an
   * open paren, so this needs no allowlist and stays correct as new SRFs are used.
   *
   * `(?![\w.])` has to come first, and it is not decoration. `[\w.]*` is greedy but backtracks: with
   * only the paren lookahead, `unnest(` fails at the full name, the engine retreats to `unnes`, finds
   * `t` rather than `(` — and happily reports a missing table called "unnes". Requiring the identifier
   * to be complete removes the shorter alternatives the engine would otherwise settle for.
   */
  for (const match of body.matchAll(/\b(?:from|join)\s+(?!\()([a-z_][\w.]*)(?![\w.])(?!\s*\()/gi)) {
    const raw = (match[1] ?? '').toLowerCase();
    // Catalogs and other schemas are outside the migration sequence.
    if (raw.startsWith('pg_') || raw.includes('.') || ctes.has(raw)) continue;
    tables.add(raw);
  }
  return [...tables];
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.error('check:sql — no migrations found in supabase/migrations');
  process.exit(1);
}

const timestamps = new Set<string>();
for (const name of files) {
  const stamp = /^(\d{14})_/.exec(name)?.[1];
  if (!stamp) {
    note(name, 'filename must start with a 14-digit timestamp (YYYYMMDDHHMMSS_name.sql)');
    continue;
  }
  if (timestamps.has(stamp)) note(name, `duplicate migration timestamp ${stamp}`);
  timestamps.add(stamp);
}

const sources = files.map((name) => ({
  name,
  sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8'),
}));

for (const { name, sql } of sources) {
  checkFile(name, sql);
}
checkFile('seed.sql', readFileSync(SEED, 'utf8'));

const seedFiles = existsSync(SEEDS_DIR)
  ? readdirSync(SEEDS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort()
  : [];
for (const name of seedFiles) {
  checkFile(`seeds/${name}`, readFileSync(join(SEEDS_DIR, name), 'utf8'));
}

// --- Check 7: forward references from `language sql` function bodies ---------
// Build "which migration first creates this table", then confirm every table a SQL
// function reads is already in existence by the time that function is created.
const createdIn = new Map<string, number>();
sources.forEach(({ sql }, index) => {
  for (const match of sql.matchAll(
    /create\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]\w*)/gi,
  )) {
    const table = (match[1] ?? '').toLowerCase();
    if (!createdIn.has(table)) createdIn.set(table, index);
  }
});

sources.forEach(({ name, sql }, index) => {
  for (const fn of sqlFunctionBodies(sql)) {
    for (const table of referencedTables(fn.body)) {
      const definedAt = createdIn.get(table);
      if (definedAt === undefined || definedAt > index) {
        note(
          name,
          `SQL function ${fn.name}() reads "${table}", which is created ` +
            `${definedAt === undefined ? 'nowhere in the migrations' : `later in ${files[definedAt]}`}. ` +
            'A `language sql` body is validated at CREATE time, so this fails on apply — ' +
            'move the function after the table (or use plpgsql, which defers).',
        );
      }
    }
  }
});

if (problems.length > 0) {
  console.error(`check:sql failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

console.log(
  `check:sql ok — ${files.length} migrations + seed.sql + ${seedFiles.length} seed file(s) ` +
    'are structurally sound.',
);
console.log('Note: only `supabase db reset` proves they actually apply.');
