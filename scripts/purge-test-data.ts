/**
 * CLI for the fixture purge. The suite runs it automatically as a teardown
 * (tests/integration/global-setup.ts); this is the manual escape hatch for when a run was
 * killed before teardown, or to tidy a database after the fact.
 *
 *   pnpm purge:test-data
 */
import { describeCounts, envFromLocalFile, purgeFixtures } from '../tests/integration/purge';

// Wrapped rather than top-level await: the package is CommonJS, so tsx transpiles to CJS
// where top-level await is a build error.
async function main(): Promise<void> {
  const env = { ...envFromLocalFile(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!url || !key) {
    console.error('Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const counts = await purgeFixtures(url, key);
  console.log(`purge:test-data — ${describeCounts(counts)}`);
  console.log(`  target: ${url}`);
}

main().catch((error: unknown) => {
  console.error(
    `purge:test-data failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
