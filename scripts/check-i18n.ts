/**
 * docs/08 §1 — sq and en must stay in lockstep; CI fails on key mismatch.
 *
 * Checks, across every locale file:
 *   1. identical key sets (reported as missing/extra, not just "differ"),
 *   2. identical leaf *shape* — a string in one locale may not be an object in another,
 *   3. no empty strings, which pass a key-set check but render as blank UI,
 *   4. matching ICU placeholders, so `{count}` cannot be dropped in translation.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MESSAGES_DIR = join(process.cwd(), 'src', 'i18n', 'messages');
const REFERENCE_LOCALE = 'sq';
const LOCALES = ['sq', 'en'] as const;

type Tree = { [key: string]: string | Tree };

function load(locale: string): Tree {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8')) as Tree;
}

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

/** ICU placeholders: `{name}` and the argument of `{count, plural, …}`. */
function placeholders(message: string): Set<string> {
  const found = new Set<string>();
  for (const match of message.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*(?:,|\})/g)) {
    if (match[1]) found.add(match[1]);
  }
  return found;
}

const problems: string[] = [];
const reference = flatten(load(REFERENCE_LOCALE));

for (const locale of LOCALES) {
  if (locale === REFERENCE_LOCALE) continue;
  const target = flatten(load(locale));

  for (const key of reference.keys()) {
    if (!target.has(key)) problems.push(`${locale}: missing key "${key}"`);
  }
  for (const key of target.keys()) {
    if (!reference.has(key))
      problems.push(`${locale}: extra key "${key}" (not in ${REFERENCE_LOCALE})`);
  }
  for (const [key, value] of target) {
    const source = reference.get(key);
    if (source === undefined) continue;

    const expected = placeholders(source);
    const actual = placeholders(value);
    for (const name of expected) {
      if (!actual.has(name)) problems.push(`${locale}: "${key}" drops placeholder {${name}}`);
    }
    for (const name of actual) {
      if (!expected.has(name))
        problems.push(`${locale}: "${key}" adds unknown placeholder {${name}}`);
    }
  }
}

for (const locale of LOCALES) {
  for (const [key, value] of flatten(load(locale))) {
    if (value.trim() === '') problems.push(`${locale}: "${key}" is empty`);
  }
}

if (problems.length > 0) {
  console.error(`check:i18n failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

console.log(`check:i18n ok — ${reference.size} keys × ${LOCALES.length} locales.`);
