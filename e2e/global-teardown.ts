import { describeCounts, envFromLocalFile, purgeFixtures } from '../tests/integration/purge';

/**
 * Playwright global teardown — the same cleanup the integration suite runs.
 *
 * M4 gave the E2E suite the ability to write: the checkout journeys place real orders
 * against whatever `.env.local` points at. Playwright runs `globalTeardown` after the whole
 * run, pass **or** fail, which is the property that matters — a failed checkout run is
 * precisely when a half-finished order is most likely to be sitting there.
 *
 * `purgeFixtures` only ever matches the fixture naming conventions (`%@biocode.test`,
 * `product-%`, `brand-%`) and refuses the production hostname outright, so it cannot
 * damage real data even if aimed at it.
 */
export default async function globalTeardown() {
  const env = { ...envFromLocalFile(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  // No service key in the environment (a plain `pnpm test:e2e` against a remote preview,
  // say) — nothing this process is allowed to clean up.
  if (!url || !key) return;

  try {
    const counts = await purgeFixtures(url, key);
    console.log(`\n[e2e teardown] purged fixtures — ${describeCounts(counts)}`);
  } catch (error) {
    // Never fail the run on cleanup; report it loudly so it gets fixed.
    console.error(
      `\n[e2e teardown] fixture purge FAILED — run \`pnpm purge:test-data\`: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
