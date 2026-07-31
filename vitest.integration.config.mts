import { defineConfig } from 'vitest/config';

/**
 * docs/09 §1 — the integration suite runs against a live local Supabase:
 *
 *   supabase start && supabase db reset && pnpm test:integration
 *
 * Separate from the unit config because it needs a real database, real RLS and real
 * JWTs. Single-threaded: the tests share one Postgres and several of them assert on
 * global state (stock ledger, rate-limit buckets).
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
