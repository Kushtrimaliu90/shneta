import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/** docs/09 §1 — desktop Chrome + a 390×844 mobile viewport. */
export default defineConfig({
  testDir: './e2e',
  /*
   * The checkout journeys place real orders, so the run refuses to start against a database
   * that has not declared itself a test target (global-setup), and cleans up after itself
   * pass or fail (global-teardown).
   */
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  /*
   * 90 s per test, up from Playwright's default 30 s.
   *
   * The checkout journeys are a dozen sequential round trips to a Supabase project in
   * eu-west-1: add to cart, read the cart, read checkout, place the order, read the success
   * page, look it up again. Individually none is slow; together they routinely pass 30 s when
   * four spec files run in parallel against one database.
   *
   * The specific failure this fixes is worth recording, because the symptom pointed the wrong
   * way: `ACTION_TIMEOUT` in checkout.spec.ts was *also* 30 s, so an assertion could never
   * spend its budget — the test died first and reported "element(s) not found", which reads
   * like a selector bug rather than a deadline. A per-assertion timeout must always sit well
   * inside the per-test one.
   *
   * This is not a performance budget. Those are in docs/09 §3, enforced in the M11 pass
   * against something better than a dev database on another continent.
   */
  timeout: 90_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm start',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
