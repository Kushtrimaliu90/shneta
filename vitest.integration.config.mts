import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * docs/09 §1 — the integration suite runs against a real Supabase, local or hosted:
 *
 *   supabase start && supabase db reset && pnpm test:integration
 *
 * Separate from the unit config because it needs a real database, real RLS and real
 * JWTs. Single-threaded: the tests share one Postgres and several of them assert on
 * global state (stock ledger, rate-limit buckets).
 *
 * WARNING: the suite creates and deletes users, products and orders. Point it at a
 * disposable database — never at production.
 */

/**
 * Vitest does not load `.env.local` into `process.env` for the node environment, and the
 * suite needs the anon and service-role keys. Parsed here rather than adding a dotenv
 * dependency for one file.
 */
function loadEnvLocal(): Record<string, string> {
  try {
    const env: Record<string, string> = {};
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match?.[1] && match[2] !== undefined) {
        env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
      }
    }
    return env;
  } catch {
    return {};
  }
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    globals: true,
    env: loadEnvLocal(),
    include: ['tests/integration/**/*.test.ts'],
    // Purges the fixtures the suite creates. Runs pass or fail — see global-setup.ts.
    globalSetup: ['./tests/integration/global-setup.ts'],
    /*
     * Generous, because a single test can be a dozen round trips and the target may be a
     * hosted project several thousand kilometres away rather than localhost. Against
     * eu-west-1 the lifecycle cases take 5–10s each; 30s was not enough.
     */
    testTimeout: 90_000,
    hookTimeout: 90_000,
    // The tests share one database and several assert on global state (stock ledger,
    // rate-limit buckets), so they must not interleave.
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
