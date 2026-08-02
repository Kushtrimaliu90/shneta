# Runbook — incident response

docs/10 §6. For when something is wrong in production and customers can tell.

## The first two minutes

**Do not start debugging.** Establish these three, in order:

1. **Can customers buy?** Open `/en/product/now-vitamin-d3-4000`, add to cart, reach
   `/en/checkout`. If that path works, you have time. If it does not, you are in a Sev 1.
2. **Is it us?** `/api/health` returns `{"status":"ok","database":"ok"}`. If `database` is not
   `ok`, check [status.supabase.com](https://status.supabase.com) before anything else.
3. **When did it start?** Vercel → Deployments. If a deploy landed just before the first report,
   that is your answer and the fix is step 1 below.

## Severity, and what it buys you

| Sev | Looks like                                                       | Response                      |
| --- | ---------------------------------------------------------------- | ----------------------------- |
| 1   | Checkout fails, the site is down, or customer data is exposed    | Roll back now, diagnose after |
| 2   | A feature is broken but orders still complete — search, wishlist | Fix forward, same day         |
| 3   | Cosmetic, one page, or a stale cache                             | Normal work                   |

A Sev 1 is defined by **what the customer cannot do**, not by how alarming the error looks. A
thousand Sentry events from a crawler hitting a 404 is a Sev 3.

## Roll back first, understand later

```bash
vercel rollback           # instant, reversible, touches no data
```

This is almost always right for a Sev 1. The instinct to find the bug first costs the shop money
per minute, and the rollback does not destroy the evidence — the failing deployment is still
there to inspect.

**Rolling back code does not roll back migrations.** If the bad release included one, see
`restore.md`. A forward-fix migration is usually safer than reverting one that has already run.

## Where to look

| Symptom                              | Look at                                                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout fails                       | Sentry, filtered to `checkout_create_order`. Then `orders` for partial rows                                                                           |
| An order was taken but no email      | `select * from email_log order by created_at desc limit 20`. `skipped_no_provider` means Resend is not configured (docs/14 §6) — expected until it is |
| Stock is wrong                       | `select * from v_stock_ledger_drift` — every row is a bug (docs/13 §P1)                                                                               |
| A page shows old content             | Cache. `POST /api/revalidate` with the tag, or check the admin action purged it (docs/13 §K1)                                                         |
| Sign-in fails for everyone           | Supabase Auth status. If it is only _some_ people, check the auth rate limit (docs/13 §N10)                                                           |
| Sign-in fails right after a test run | The auth quota. It clears itself in minutes; re-running makes it worse                                                                                |
| A page 500s with no useful message   | Production redacts Server Component errors. Reproduce against `pnpm dev`, which names the component (docs/13 §P6)                                     |
| Renewals did not go out              | `/admin/subscriptions` cron health widget, then `email_log` for `subscription_%`                                                                      |

## Cron failures

Both crons are idempotent by design, so **re-running one is safe**:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/subscriptions
```

`claim_due_subscription` advances the schedule in the same statement that finds a subscription
due (docs/13 §O1), so a second invocation builds nothing. Do not "fix" a missed run by editing
`next_run_at` — that skips the claim and can ship twice.

## Data exposure

If personal data may have been exposed, stop and escalate to the owner. Do not delete anything:
the logs are how the scope gets established, and GDPR gives 72 hours to notify from the point of
becoming aware — the clock is already running.

Preserve: Vercel logs, Sentry events, the relevant `audit_logs` rows, and the timestamps.

## Communicating

- **Under 15 minutes and orders unaffected:** say nothing publicly, note it internally.
- **Checkout was down:** say so on the site once it is back. A customer whose order failed will
  try again if they know it was temporary, and will not if they think it is broken.
- **An individual customer is affected:** contact them directly, before they contact you.

Never post a status update that says "resolved" until step 2 of the closing checklist passes.

## Closing an incident

1. `/api/health` green, and a real order placed and cancelled by hand.
2. `pnpm test:integration` green against production **only if** you are confident the fixture
   purge is correctly gated (docs/14 §7) — otherwise skip it and test by hand.
3. Write it down: what broke, what the customer saw, what fixed it, how long.
4. One sentence on what would have caught it earlier. If the answer is a test, write the test —
   the entries in docs/13 that are worth anything are the ones that came with one.
