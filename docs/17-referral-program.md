# 17 · REFERRAL PROGRAM (M13)

Customers invite customers. A referred customer is linked to exactly one referrer, and for **12
months** from linking, the referrer earns **1% of the referred customer's eligible spend, paid in
points**. Admin reviews, approves, revokes, and can link manually. The referrer sees points and
counts — never what their referrals bought, spent, or when.

> **Numbered 17, not 16.** The spec arrived headed "16 · REFERRAL PROGRAM"; docs/16 is the merchant
> marketplace, which is built and shipped. Nothing else changes.

Conventions unchanged: TS strict, server actions + Zod + `ActionResult`, money in integer cents, RLS
as the security boundary, sq/en, everything audited.

---

## 0 · Decisions resolved before coding

### 0.1 · One point value — and it cuts the loyalty rate by 5×

The pack defined loyalty as *earn 1 point per €1, redeem 100 points = €5*. The referral spec assumed
*100 points = €1*. One wallet cannot hold two point values, so **1 point = €0.01 everywhere**:

| | Own purchases | Referral | Redemption |
| --- | --- | --- | --- |
| Rule | 1 point per €1 | 1 point per €1 of referee spend | 100 points = €1, minimum 500 |
| Effect | 1% back | 1% of their spend | — |

**The consequence worth stating out loud, because the spec does not:** the old rule paid €5 for 100
points on €100 of spend — **5% back**. The new rule pays €1 — **1% back**. This is not a rename; it
is an 80% reduction in what the loyalty programme returns to a customer. It is coherent (everything
gives 1% back, a point is a cent, and that sentence survives translation into Albanian), it is safe
to do now because nothing has launched and no real points exist, and it is a **commercial decision**
rather than a technical one. Recorded here so nobody later finds it by arithmetic.

**Settings keys are renamed, not just revalued**, because the existing names encode the old model:

| Before | After |
| --- | --- |
| `earn_rate_points_per_eur: 1` | `earn_points_per_eur: 1` |
| `redeem_points: 100` + `redeem_value_cents: 500` | `point_value_cents: 1` + `min_redeem_points: 500` |

**Redemption becomes variable.** Today it mints a fixed €5 coupon for exactly 100 points. "Minimum
500" implies choosing an amount, so redemption takes a multiple of 100 points at or above 500 and
mints a coupon worth `points × point_value_cents`. That is a behaviour change to the redeem RPC and
the account UI, not a settings edit.

### 0.2 · Attribution privacy has a hard limit

If a referrer has exactly one active referral, "points earned" × €0.01 × 100 **is** that person's
spend. No UI hides arithmetic. All four mitigations are mandatory:

- Never show per-referee earnings, order counts, order dates, or amounts.
- Post referral accrual in **monthly batches** (`accrual_mode: monthly` default, `immediate`
  optional) so timing does not reveal purchase dates.
- The referrer's ledger line reads "Fitime nga referimet — {muaji}" with no breakdown.
- The programme terms state plainly that earnings are a percentage of referred purchases, so a
  referred customer knows the shape of what is shared about them.

---

## 1 · Mechanics

- **Code.** Permanent, human-readable, issued on account creation: `BIO-` + 5 chars from
  `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I/O/0/1), e.g. `BIO-K7F2M`. Immutable, case-insensitive
  (citext).
- **Linking.** Entered at sign-up, or via `/r/{CODE}` which stores the code in a 30-day httpOnly
  cookie and pre-fills the field. A grace window allows entry **until the first order is placed**
  (account → "Kam një kod ftese"), after which the field disappears.
- **One referrer per customer, forever.** Unique constraint on `referee_id`. A second code entry is
  rejected clearly. A referrer may have unlimited referees.
- **No cycles, no self-referral.** Reject if referee = referrer, if the referrer is transitively the
  referee's own referee, or if email/phone match. Single-level only: A→B→C pays A nothing for C.
- **Approval.** New links land `pending`. `auto_approve` (default **false** at launch) controls
  whether they auto-approve on the referee's first delivered order. Accrual only on `approved`.
- **Clock.** `expires_at = linked_at + 12 months`, where `linked_at` is the **approval** timestamp.
  Shown to both parties. Not extendable, except once by an admin with an audited note.
- **Eligible spend.** Per referred order, `subtotal_cents − discount_cents` (excludes shipping;
  VAT-inclusive prices are the base, matching loyalty). Counted only at `delivered`, and only if
  `delivered_at ≤ expires_at`.
- **Rate.** `rate_pct` (default 1.00). `points = floor(base_cents × rate_pct / 100 /
  point_value_cents)` → €100 eligible spend = 100 points = €1.
- **Clawback.** A refund or return on a counted order writes a negative earning and negative points,
  floored so a balance never goes below zero; the shortfall is recorded and netted against future
  accrual.
- **Caps.** `max_referrals_per_customer` (null = unlimited), `max_points_per_link_per_year` (20000 =
  €200), `min_order_cents_to_count` (1000). Exceeding a cap stops accrual and **flags the link for
  review** rather than silently dropping it.
- **Termination.** `revoke` stops future accrual immediately and keeps points already paid; removing
  earned points is a separate audited `adjustment`. Deleting or anonymising an account revokes its
  links.

## 2 · Data model

One migration: `referral_link_status` enum, `profiles.referral_code citext unique` with a backfill
and generation in `handle_new_user`, `referral_links`, `referral_earnings`. Full DDL in the build
(migration 52). `unique (referee_id)` is the one-referrer rule; `unique (order_id, reason)` on
earnings is the accrual idempotency.

Settings key `referral`:

```json
{ "enabled": true, "rate_pct": 1.00, "duration_months": 12, "auto_approve": false,
  "accrual_mode": "monthly", "min_order_cents_to_count": 1000,
  "max_points_per_link_per_year": 20000, "max_referrals_per_customer": null,
  "grace": "until_first_order" }
```

## 3 · Accrual engine

`accrue_referral_for_order(order_id)`, called from the existing `delivered` trigger path after the
loyalty earn, idempotent via the unique constraint:

1. Find an `approved` link where `referee_id = order.user_id`. Guest orders never accrue — no
   account, no link.
2. Guard: `delivered_at ≤ expires_at`; base ≥ `min_order_cents_to_count`; per-link yearly cap not
   exceeded (award up to the cap, then flag).
3. Compute base and points; insert `referral_earnings`.
4. Post per `accrual_mode`: `immediate` writes `loyalty_transactions` now, `monthly` leaves it
   unposted for the cron. Either way the earning row exists immediately for admin.
5. Refunds call the same function with `reason='refund'` and a negative base.

Four details the implementation settled (migration 58), because each of them is a decision rather
than a mechanic:

- **The insert is the idempotency, not a preceding check.** The earning row is written before the
  wallet moves, so a second concurrent call loses the unique `(order_id, reason)` conflict, gets no
  row back and never posts. Posting first and deleting on conflict is the same race with extra steps.
- **One `refund` row per order, carrying the running total.** The unique constraint means a second
  partial refund cannot add a second row, so the row holds the cumulative clawback and only the
  *difference* reaches the wallet. Written naively, refunding €50 of a €100 order twice would reclaim
  only the first half's points.
- **Referral ledger rows carry no `order_id`.** An order id on the referrer's own ledger row would
  date a referred customer's shopping, which is exactly what §0.2 protects. The order lives on
  `referral_earnings`, which has no customer policy at all, so there is no join to follow.
- **A clawback is floored to the referrer's balance.** `sync_loyalty_balance` clamps the balance at
  zero, so posting −100 against a balance of 20 would leave the balance at 0 and the ledger summing to
  −80 — and a ledger that disagrees with the balance is worse than an under-recovered clawback.

`/api/cron/referrals`, `CRON_SECRET`-guarded, daily: monthly posting on the 1st (one ledger row per
referrer per month), expiry flips, T−30 and T−7 expiry emails, and auto-approve when enabled.

**The monthly sweep must be a true-up, not a sum of unposted rows.** Because a clawback posts only
what the balance allowed, the amount a referrer is owed is
`sum(referral_earnings.points) − sum(posted referral loyalty_transactions)` across the whole link, not
the total of rows whose `loyalty_transaction_id` is null. Summing unposted rows would pay a shortfall
twice: once as an unrecovered clawback, and again the following month. `loyalty_transaction_id` marks
a row as settled and is what stops the sweep re-paying it; the true-up is what makes the two ledgers
agree.

## 4 · Customer experience

`/account/referrals` — code with copy button, share link `https://biocode.fit/r/{CODE}` with native
share plus WhatsApp and Viber (Kosovo defaults) and a prewritten sq message, QR for in person.
Aggregate stats only: approved · pending · expiring within 30 days · points all-time · points this
month · wallet balance with a redeem CTA. The referral list shows a masked label ("Arta B."), join
month, status chip, days remaining — and **never** spend, attributed points, order count, dates,
email or phone. Enforced in the RPC, not the component.

Sign-up gains an optional "Kod ftese (opsionale)" field, pre-filled from the cookie, validated live.
The referee's account shows one quiet line and a link to the terms. A welcome incentive is **out of
scope for v1**.

## 5 · Admin (`/admin/referrals`)

Queue (pending, with risk flags and signup gap) · Links (filter, search, revoke, extend once, view
earnings) · Manual link (clock today or backdated, note required, same validity rules) · Earnings
(ledger, CSV, and the euro-equivalent liability surfaced on the dashboard as "Detyrim pikësh") ·
Fraud panel (clusters by IP/phone/address/rapid signup, abnormal ratios, revoke-all-for-referrer) ·
Settings. All mutations audited. `admin` full; `support` queue + revoke.

## 6 · Privacy and security

- RLS: a referrer reads its links **through the RPC only**; a referee reads its own single row; staff
  read all. **No client-side select on `referral_earnings` at all.**
- One read path for the customer UI: `my_referral_overview()`, security definer, returning
  `{code, stats, referrals[]}` with masked labels. It must be impossible to obtain a per-referee
  amount from any endpoint — asserted by a test on the RPC's shape.
- Code entry rate-limited 10/h per IP and per account, with **one generic invalid message** so the
  response cannot distinguish "does not exist" from "exists but already used".
- Never expose `referee_id`, emails or order ids to the referrer.
- Terms page in `pages`, sq/en, `[LEGAL: review]`: rate, duration, eligible spend, what is shared,
  clawback, cap, abuse termination, right to change the rate prospectively.

## 7 · Emails

Referrer: joined (pending) · approved · monthly earnings summary · T−30 and T−7 expiry · revoked.
Referee: welcome mentioning the friend's code and a link to the terms. Bilingual, logged.

**The rule all seven obey:** nothing about the referred customer. Not a name, not an order, not an
amount, not a date. §0.2 spends the whole design keeping a referrer from learning what their referral
bought, and an email is the easiest place to give it away — "Arta just ordered!" reads like a nice
touch and is a disclosure. The subject of every sentence is the referrer and their own points.

**Three are built** (`src/features/referrals/email.ts`), the three the cron sends: the monthly summary
and the two expiry notices, which share one template because they say the same thing at different
volumes.

**Four remain**, and the delivery mechanism for them is decided rather than open, because the obvious
one does not work. `joined`, `approved`, `revoked` and the referee's `welcome` are all triggered by a
state change that can happen in **four different places** — the sign-up trigger inside
`handle_new_user` (which is SQL and cannot send mail), the account claim action, the admin queue, and
the auto-approve cron. Wiring each site separately means four call sites, three of which are easy to
forget and one of which is impossible.

So: **a sweep with a per-link flag.** Add `joined_email_at`, `approved_email_at` and
`revoked_email_at` to `referral_links`; the daily cron selects links whose relevant column is null and
whose state qualifies, sends, and stamps the column. One implementation, idempotent by the flag rather
than by luck, and it covers a link however it was created — including one an admin made by hand at a
psql prompt. The cost is up to a day's delay on a "somebody used your code" email, which is the right
trade for a message nobody acts on urgently.

## 8 · Build order

1. ~~Migration + backfill + trigger + RLS + `my_referral_overview` and its shape test.~~ **Done.**
2. ~~Point-value unification (§0.1) across settings, loyalty UI, emails, seed.~~ **Done.**
3. ~~Code entry: sign-up field, `/r/{CODE}` + cookie, account grace entry, validation.~~ **Done.**
4. ~~Accrual engine + delivered hook + refund clawback + idempotency tests.~~ **Done.**
5. ~~Account referrals page.~~ **Done.**
6. ~~Admin queue, links, manual link, revoke, earnings, fraud panel, settings.~~ **Done.**
7. ~~Crons: monthly posting, expiry, emails, optional auto-approve.~~ **Done** — `/api/cron/referrals`,
   four passes, with the monthly summary and both expiry notices.
8. ~~Emails; terms page; E2E + a11y.~~ **Done.** All seven templates ship, the four event-driven ones via
   the sweep in §7. The terms page landed with step 3. `e2e/referrals.spec.ts` is 40 checks across both
   viewports including axe on every new screen, and `tests/unit/referral-email-copy.test.ts` holds §0.2's
   rule against the copy table itself — an allowlist of the placeholders this feature has data for, so a
   future template cannot describe a referred customer's spending even by accident.

## 9 · Tests

**Unit:** points math at boundaries (€9.99, €100, cap edge), clawback flooring, expiry boundary
(delivered at `expires_at` ± 1s), code generator (alphabet, uniqueness, collision retry).
**Integration:** one-referrer-per-referee under concurrent signups; self and cycle rejection; accrual
idempotency; guest orders accrue nothing; revoked link stops accrual but keeps points; monthly
posting aggregates; RLS — referrer A cannot read B's links or any earning row directly.
**E2E:** A copies code → B signs up with it → admin approves → B orders → delivered → A's dashboard
shows more points and one active referral **and no amount attributable to B**; expiry cron flips
status and "expiring soon" is right.

**Definition of done:** a referrer invites by code or link in two taps and sees counts, points and
expiries and nothing more; admin can approve, revoke and link manually with a full audit trail; €100
of delivered eligible spend produces exactly 100 points; refunds claw back; the clock stops at 12
months; and no endpoint reveals a referred customer's spending.
