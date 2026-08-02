import { assertNoRealOrders, assertPurgeable, envFromLocalFile } from '../tests/integration/purge';

/**
 * Playwright global setup — refuses to run against an undeclared database.
 *
 * The checkout journeys place real orders, create guest carts and consume real stock. On a
 * database that also serves customers that is not a tidy-up problem, it is a data-integrity
 * one: the orders are real rows in the real `orders` table, they appear in the admin queue,
 * and the stock they consume is stock somebody was going to sell.
 *
 * So the run stops here unless `SUPABASE_TEST_PROJECT` matches the target project ref. The
 * same check gates `tests/integration/helpers.ts` and the fixture purge — one rule, three
 * places it has to hold.
 *
 * Note this is deliberately *not* conditional on finding credentials. A run with no service
 * key still drives a browser against `E2E_BASE_URL`, and that server has its own credentials
 * pointing somewhere — quite possibly production. What matters is the database the app under
 * test writes to, which is why the URL is read the same way the app reads it.
 */
export default async function globalSetup() {
  const env = { ...envFromLocalFile(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!url) {
    throw new Error(
      'E2E cannot verify which database it is about to write to: NEXT_PUBLIC_SUPABASE_URL is ' +
        'unset. Refusing to run rather than guessing.',
    );
  }

  assertPurgeable(url);

  /*
   * The second guard — ask the database, not the config (see `assertNoRealOrders`).
   *
   * Skipped without a service key, which is the one case where it cannot run: a browser-only
   * run against `E2E_BASE_URL` has no credentials of its own. `assertPurgeable` still applied
   * above, and that check needs no database access.
   */
  if (key) await assertNoRealOrders(url, key);
}
