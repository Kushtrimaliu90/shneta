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
  resolve: {
    tsconfigPaths: true,
    /*
     * `import 'server-only'` neutralised, for this suite only.
     *
     * The package ships two entry points: a no-op for the server and a module that throws for the
     * browser. Vitest's node environment resolves the **browser** one — its `exports` map keys on
     * conditions Next sets and Vitest does not — so importing any `server-only` module from a test dies
     * with "This module cannot be imported from a Client Component module."
     *
     * The guarantee `server-only` exists for is about the **client bundle**: it stops a module holding a
     * service-role key from being shipped to a browser, and `next build` is what enforces that. A node
     * test runner is not a browser, so stubbing it here removes nothing real — and the alternative is
     * being unable to test the email senders at all, which is how an email nobody can exercise ships
     * addressed to the wrong person.
     *
     * The unit config deliberately does **not** have this alias: nothing there touches the database, and
     * a unit test reaching for a server-only module is a sign the module boundary is wrong.
     */
    alias: { 'server-only': new URL('./tests/integration/server-only-stub.ts', import.meta.url).pathname },
  },
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
