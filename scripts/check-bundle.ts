/**
 * Enforces the First Load JS budget from docs/09 §3.
 *
 * This exists because the budget was breached silently once already: adding Sentry took the
 * shell from 120 kB to 204 kB and nothing failed — the build printed a bigger number and
 * moved on. A budget nobody checks is a comment.
 *
 * Two measurement modes, because Next 16 changed what the build emits:
 *
 *  · **Per-route** (`app-build-manifest.json`) — webpack builds, Next ≤ 15. Sums the unique
 *    JS each route loads on first paint. This is the ideal measure.
 *  · **Shared baseline** (`build-manifest.json` → `rootMainFiles` + polyfills) — Turbopack
 *    builds, Next 16+, which no longer emit a per-route manifest and no longer print size
 *    columns at all. This is the floor every route pays, so it still catches the failure
 *    that matters most: a heavy dependency landing in the shared chunk.
 *
 * Sizes are gzipped, the same unit docs/09 §3 states its budget in.
 *
 * Run after `pnpm build`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const NEXT_DIR = join(process.cwd(), '.next');
const APP_MANIFEST = join(NEXT_DIR, 'app-build-manifest.json');
const BUILD_MANIFEST = join(NEXT_DIR, 'build-manifest.json');

/** docs/09 §3, verbatim: storefront routes < 170 kB gz, checkout < 200 kB gz. */
const STOREFRONT_BUDGET = 170 * 1024;
const CHECKOUT_BUDGET = 200 * 1024;

/**
 * The shared chunk is held tighter than a whole route: it is pure overhead paid by every
 * page before any page-specific code, so leaving headroom for the actual features is the
 * point. Today it sits around 105 kB.
 */
const SHARED_BASELINE_BUDGET = 130 * 1024;

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} kB`;

function gzippedTotal(files: readonly string[]): number {
  let total = 0;
  for (const file of new Set(files)) {
    if (!file.endsWith('.js')) continue;
    const path = join(NEXT_DIR, file);
    // Per-file gzip, matching how a CDN serves them — one chunk per response.
    if (existsSync(path)) total += gzipSync(readFileSync(path)).length;
  }
  return total;
}

function checkPerRoute(): boolean {
  const manifest = JSON.parse(readFileSync(APP_MANIFEST, 'utf8')) as {
    pages: Record<string, string[]>;
  };

  let failed = false;
  console.log('check:bundle — first-load JS per route (gzipped):');

  for (const [route, files] of Object.entries(manifest.pages)) {
    if (!route.startsWith('/[locale]')) continue;

    const isCheckout = route.startsWith('/[locale]/(storefront)/checkout');
    const budget = isCheckout ? CHECKOUT_BUDGET : STOREFRONT_BUDGET;
    const size = gzippedTotal(files);
    const over = size > budget;
    if (over) failed = true;

    console.log(
      `  ${over ? 'FAIL' : 'ok  '} ${route.padEnd(34)} ${kb(size).padStart(9)} / ${kb(budget).padStart(9)}`,
    );
  }

  return failed;
}

function checkSharedBaseline(): boolean {
  const manifest = JSON.parse(readFileSync(BUILD_MANIFEST, 'utf8')) as {
    rootMainFiles?: string[];
    polyfillFiles?: string[];
  };

  const files = [...(manifest.rootMainFiles ?? []), ...(manifest.polyfillFiles ?? [])];
  if (files.length === 0) {
    console.error('check:bundle — build manifest has no client entry files; cannot measure.');
    process.exit(1);
  }

  const size = gzippedTotal(files);
  const over = size > SHARED_BASELINE_BUDGET;

  console.log('check:bundle — shared client baseline (gzipped, paid by every route):');
  console.log(
    `  ${over ? 'FAIL' : 'ok  '} shared chunk${' '.repeat(22)} ${kb(size).padStart(9)} / ${kb(
      SHARED_BASELINE_BUDGET,
    ).padStart(9)}`,
  );
  console.log(
    '  note: this build has no per-route manifest (Turbopack), so only the shared\n' +
      `        baseline is enforced. Route budgets remain ${kb(STOREFRONT_BUDGET)} / ${kb(CHECKOUT_BUDGET)} checkout.`,
  );

  return over;
}

if (!existsSync(APP_MANIFEST) && !existsSync(BUILD_MANIFEST)) {
  console.error('check:bundle — no build manifest. Run `pnpm build` first.');
  process.exit(1);
}

const failed = existsSync(APP_MANIFEST) ? checkPerRoute() : checkSharedBaseline();

if (failed) {
  console.error(
    '\ncheck:bundle FAILED. Before raising the budget, try: a dynamic import for the heavy ' +
      'widget, a Server Component instead of a client one, or dropping the dependency. ' +
      'See docs/13 §G3 for how Sentry was handled.',
  );
  process.exit(1);
}

console.log('check:bundle ok — within the docs/09 §3 budget.');
