/**
 * Enforces the First Load JS budget from docs/09 §3.
 *
 * This exists because the budget was breached silently once already: adding Sentry took the
 * shell from 120 kB to 204 kB, and nothing failed — the build printed a bigger number and
 * moved on. A budget nobody checks is a comment.
 *
 * Reads `.next/app-build-manifest.json` and sums the gzipped size of the unique JS a route
 * loads on first paint — the same measure docs/09 §3 states its budget in.
 *
 * Run after `pnpm build`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const NEXT_DIR = join(process.cwd(), '.next');
const MANIFEST = join(NEXT_DIR, 'app-build-manifest.json');

/**
 * docs/09 §3, verbatim: storefront routes < 170 kB gz, checkout < 200 kB gz.
 *
 * Measured gzipped rather than raw so the number compared is the number the budget is
 * written in — no conversion factor to get wrong or to drift as compression changes.
 */
const BUDGETS: { pattern: RegExp; label: string; maxBytes: number }[] = [
  { pattern: /^\/\[locale\]\/\(storefront\)\/checkout/, label: 'checkout', maxBytes: 200 * 1024 },
  { pattern: /^\/\[locale\]/, label: 'storefront', maxBytes: 170 * 1024 },
];

if (!existsSync(MANIFEST)) {
  console.error('check:bundle — no build manifest. Run `pnpm build` first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
  pages: Record<string, string[]>;
};

function bytesFor(files: string[]): number {
  let total = 0;
  for (const file of new Set(files)) {
    if (!file.endsWith('.js')) continue;
    const path = join(NEXT_DIR, file);
    // Per-file gzip, matching how a CDN serves them — one chunk per response.
    if (existsSync(path)) total += gzipSync(readFileSync(path)).length;
  }
  return total;
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} kB`;

let failed = false;
const rows: string[] = [];

for (const [route, files] of Object.entries(manifest.pages)) {
  const budget = BUDGETS.find((candidate) => candidate.pattern.test(route));
  if (!budget) continue;

  const size = bytesFor(files);
  const over = size > budget.maxBytes;
  if (over) failed = true;

  rows.push(
    `  ${over ? 'FAIL' : 'ok  '} ${route.padEnd(34)} ${kb(size).padStart(9)} / ${kb(
      budget.maxBytes,
    ).padStart(9)}  (${budget.label})`,
  );
}

if (rows.length === 0) {
  console.error('check:bundle — no routes matched a budget; check the patterns.');
  process.exit(1);
}

console.log('check:bundle — first-load JS per route (gzipped):');
for (const row of rows) console.log(row);

if (failed) {
  console.error(
    '\ncheck:bundle FAILED. Before raising the budget, try: dynamic import for the heavy ' +
      'widget, a Server Component instead of a client one, or dropping the dependency. ' +
      'See docs/13 §G3 for how Sentry was handled.',
  );
  process.exit(1);
}

console.log('check:bundle ok — every route is within the docs/09 §3 budget.');
