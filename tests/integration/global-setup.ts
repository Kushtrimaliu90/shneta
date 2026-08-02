import { assertNoRealOrders, describeCounts, envFromLocalFile, purgeFixtures } from './purge';

/**
 * Vitest global setup/teardown for the integration suite.
 *
 * The returned function is a **teardown**: Vitest runs it after the whole suite whether it
 * passed or failed. That matters — chaining a cleanup step with `&&` would skip it on
 * failure, which is exactly when fixtures are most likely to have leaked.
 */
export default async function setup() {
  /*
   * Before anything runs, ask the database whether it holds a real customer's order.
   *
   * `helpers.ts` already calls `assertPurgeable` at module scope, which is the earlier and more
   * important guard — it throws during import, before a single fixture is inserted. This one
   * needs a round trip and so cannot live there, but it catches the case the other cannot: an
   * environment that still *declares* itself a test target long after it stopped being one
   * (docs/14 §7). Vitest awaits this before collecting any test file.
   */
  const setupEnv = { ...envFromLocalFile(), ...process.env };
  const setupUrl = setupEnv.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const setupKey = setupEnv.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (setupUrl && setupKey) await assertNoRealOrders(setupUrl, setupKey);

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
