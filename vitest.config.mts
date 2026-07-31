import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Resolves the `@/*` alias from tsconfig.json natively (no vite-tsconfig-paths needed).
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    /**
     * `lib/env.client.ts` validates at import time so the app fails fast (docs/10 §3).
     * Anything that transitively imports it therefore needs a valid public environment;
     * these mirror the `supabase start` defaults in .env.example.
     */
    env: {
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key-not-a-real-credential',
    },
    // docs/09 §1 — unit suite only. The integration suite needs a live local Supabase and
    // is run separately in CI (see .github/workflows/ci.yml).
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/features/**/schemas.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
