#!/usr/bin/env tsx
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regenerate `src/lib/supabase/database.types.ts` (CLAUDE.md §1 — after every migration).
 *
 * ── Why this is a script and not a shell redirect ──
 *
 * It used to be `supabase gen types typescript --local > src/lib/supabase/database.types.ts`, and a
 * shell truncates the target **before** running the command. So one `pnpm db:types` against a
 * database that is not running deletes four thousand lines of types and reports a failure that looks
 * like it changed nothing. The next `pnpm typecheck` then produces several hundred errors that have
 * nothing to do with anything you edited.
 *
 * Generating into memory and writing only on success makes the failure mode "nothing happened",
 * which is what a failed command should do.
 */

const TARGET = resolve(process.cwd(), 'src/lib/supabase/database.types.ts');

const target = process.argv.includes('--linked') ? '--linked' : '--local';

/*
 * A single command string through the shell.
 *
 * The Windows CLI is a `.CMD` shim, and since Node 20 closed CVE-2024-27980 spawning one without a
 * shell fails outright with `EINVAL`. Passing an argument array *with* `shell: true` then earns
 * DEP0190, because the array gets concatenated into a command line rather than passed. One literal
 * string is the honest form of what actually happens, and every token in it is a constant.
 */
const command = `supabase gen types typescript ${target}`;

let generated: string;
try {
  generated = execSync(command, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`db:types failed against ${target}; ${TARGET} left untouched.\n${message}`);
  if (target === '--local') {
    console.error('Is the local stack running? `supabase start`, or use `pnpm db:types:linked`.');
  }
  process.exit(1);
}

/*
 * A successful exit with a stub body is the other way this goes wrong: the CLI prints a valid but
 * empty `Database` type when it cannot introspect. Writing that is worse than writing nothing,
 * because it typechecks.
 */
if (!generated.includes('public: {') || generated.length < 10_000) {
  console.error(
    `db:types produced ${generated.length} characters with no public schema — refusing to write it.`,
  );
  process.exit(1);
}

writeFileSync(TARGET, generated, 'utf8');
console.log(`db:types ok — ${generated.split('\n').length} lines from ${target}.`);
