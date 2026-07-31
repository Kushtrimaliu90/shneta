import { describeCounts, envFromLocalFile, purgeFixtures } from './purge';

/**
 * Vitest global setup/teardown for the integration suite.
 *
 * The returned function is a **teardown**: Vitest runs it after the whole suite whether it
 * passed or failed. That matters — chaining a cleanup step with `&&` would skip it on
 * failure, which is exactly when fixtures are most likely to have leaked.
 */
export default function setup() {
  return async function teardown() {
    const env = { ...envFromLocalFile(), ...process.env };
    const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!url || !key) return;

    try {
      const counts = await purgeFixtures(url, key);
      console.log(`\n[teardown] purged fixtures — ${describeCounts(counts)}`);
    } catch (error) {
      // Never fail the run on cleanup; report it loudly so it gets fixed.
      console.error(
        `\n[teardown] fixture purge FAILED — run \`pnpm purge:test-data\`: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };
}
