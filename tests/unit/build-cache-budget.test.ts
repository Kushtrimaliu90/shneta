import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ISR_REVALIDATE_SECONDS } from '@/lib/constants';

/**
 * Reads what Next actually compiled, not what the source says it wants.
 *
 * ── Why this exists ──
 *
 * On 8 Aug the storefront was given two cache tiers: a day for pages with no price or stock on them, an
 * hour for the catalogue. The build ignored both. Every one of 174 prerendered routes came out at **60
 * seconds**, including the legal pages set to 86400, and the change was reported as shipped without
 * anyone reading the build output. ISR Writes then rose from $0.97 to $2.18 a day while the fix was
 * believed to be in place.
 *
 * The cause is a rule that is easy to state and invisible in a diff: a route's cache life is the
 * **shortest** cache used while rendering it. One `unstable_cache({ revalidate: 60 })` awaited in the
 * shared storefront layout therefore caps every page in the site, whatever each page declares. Nothing
 * in the source of `legal/terms/page.tsx` hints that another file decides its number.
 *
 * So the assertion has to be made against `.next/prerender-manifest.json` — the artefact Vercel actually
 * bills from. A unit test over the source could not have caught this, and neither could a reviewer.
 *
 * ── Skipped without a build ──
 *
 * `pnpm test` runs without `pnpm build` in development. The manifest is checked in CI, where the build
 * step precedes the tests, and locally after any build. A skip is honest; a pass on a missing file is not.
 */
const MANIFEST = join(process.cwd(), '.next/prerender-manifest.json');

interface Manifest {
  routes: Record<string, { initialRevalidateSeconds: number | false }>;
}

/** The tier each path is expected to land in. Longest match wins. */
const EXPECTED: { prefix: string; seconds: number; why: string }[] = [
  { prefix: '/legal/', seconds: ISR_REVALIDATE_SECONDS, why: 'no price or stock on the page' },
  { prefix: '/knowledge', seconds: ISR_REVALIDATE_SECONDS, why: 'editorial content' },
  { prefix: '/ingredients', seconds: ISR_REVALIDATE_SECONDS, why: 'reference content' },
  { prefix: '/about', seconds: ISR_REVALIDATE_SECONDS, why: 'static copy' },
  { prefix: '/faq', seconds: ISR_REVALIDATE_SECONDS, why: 'static copy' },
  { prefix: '/brands', seconds: ISR_REVALIDATE_SECONDS, why: 'taxonomy' },
  { prefix: '/goals', seconds: ISR_REVALIDATE_SECONDS, why: 'taxonomy' },
  { prefix: '/product/', seconds: ISR_REVALIDATE_SECONDS, why: 'carries price and stock' },
  { prefix: '/offers', seconds: ISR_REVALIDATE_SECONDS, why: 'carries price' },
];

function stripLocale(route: string): string {
  return route.replace(/^\/(sq|en)(?=\/|$)/, '') || '/';
}

describe.skipIf(!existsSync(MANIFEST))('the build honours its own cache tiers', () => {
  /*
   * Guarded again inside the body, not only in the `skipIf`: vitest still EXECUTES a skipped
   * describe's callback to collect its tests, so an unconditional `readFileSync` here crashed
   * the whole suite on any machine without a build — exactly the buildless CI Quality job the
   * skip exists for. The skip decides whether the tests run; this guard decides whether
   * collection survives. Both read the same condition, so they cannot disagree.
   */
  const manifest: Manifest = existsSync(MANIFEST)
    ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest)
    : { routes: {} };
  const routes = Object.entries(manifest.routes ?? {});

  it('found a manifest with routes in it', () => {
    // A guard that silently measures nothing passes forever.
    expect(routes.length).toBeGreaterThan(50);
  });

  it('does not cap the whole site at one minute', () => {
    /*
     * The specific regression, asserted bluntly. 60 seconds is nobody's declared intent anywhere in the
     * app; if it reappears, some shared read has a short cache and is dragging every page down with it.
     */
    const perMinute = routes.filter(([, meta]) => meta.initialRevalidateSeconds === 60);
    expect(
      perMinute.length,
      `${perMinute.length} routes rebuild every 60s. A short cache in a shared layout caps every page ` +
        `that renders through it — check unstable_cache revalidate values reachable from ` +
        `(storefront)/layout.tsx. Examples: ${perMinute
          .slice(0, 5)
          .map(([route]) => route)
          .join(', ')}`,
    ).toBe(0);
  });

  it.each(EXPECTED)(
    '$prefix rebuilds no more often than its tier ($why)',
    ({ prefix, seconds }) => {
      const matching = routes.filter(([route]) => stripLocale(route).startsWith(prefix));
      // Not every prefix is prerendered in every build; an empty match is not a failure.
      for (const [route, meta] of matching) {
        if (meta.initialRevalidateSeconds === false) continue;
        expect(
          meta.initialRevalidateSeconds,
          `${route} rebuilds every ${meta.initialRevalidateSeconds}s but its tier is ${seconds}s`,
        ).toBeGreaterThanOrEqual(seconds);
      }
    },
  );

  it('reports the spread, so a regression is legible in the output', () => {
    const spread = new Map<string, number>();
    for (const [, meta] of routes) {
      const key = String(meta.initialRevalidateSeconds);
      spread.set(key, (spread.get(key) ?? 0) + 1);
    }
    // Not an assertion about the numbers — a printed census, so a failure above has context beside it.
    console.info('  cache tiers in this build:', Object.fromEntries(spread));
    expect(spread.size).toBeGreaterThan(0);
  });
});
