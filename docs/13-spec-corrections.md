# 13 · Spec Corrections (v2.0.1)

Defects found while implementing the pack. Each entry is a **decision**, not an option: the
implementation follows the "Fix" column, and the affected source doc should be amended.
Ordered by severity. Items marked **BLOCKER** would have shipped a broken or insecure system.

Precedence note: this document amends `03-database.md`, `04-design-system.md`,
`07-commerce-logic.md` and `02-architecture.md` on the specific points listed. Everything not
listed here stands as written.

---

## A. Correctness blockers — checkout & data integrity

### A1 · BLOCKER — `checkout_create_order` pass 2 does not filter the catalog the way pass 1 does

`03-database.md §8`. Pass 1 (pricing/stock) joins with `pv.is_active`, `p.status='published'`,
`p.deleted_at is null`. Pass 2 (item snapshot + stock decrement) joins **without any of them**.

A cart holding a variant that was deactivated or a product that was unpublished/soft-deleted
between add-to-cart and checkout therefore:

- is **excluded** from `subtotal` (pass 1 skips it) — the customer is not charged for it, and
- is **inserted as an order item and decremented from stock** (pass 2 includes it).

Result: goods shipped for free, and `inventory_levels.on_hand` driven toward the
`on_hand >= 0` check constraint, which aborts the transaction with an opaque error.

**Fix:** both passes select from one shared, filtered set. Implemented as a single `for` loop
over a CTE, with an explicit `CART_ITEM_UNAVAILABLE:<sku>` error when a cart line no longer
resolves to a purchasable variant, so the UI can prune the line and tell the customer.

### A2 · BLOCKER — `refresh_product_rating` errors on `DELETE`

`03-database.md §8`. `declare pid uuid := coalesce(new.product_id, old.product_id);` in a trigger
fired `after insert or update ... or delete`. In PL/pgSQL, `NEW` is _unassigned_ during `DELETE`
(and `OLD` during `INSERT`); referencing a field raises
`record "new" is not assigned yet`. Deleting a review therefore fails outright, and the `INSERT`
path only survives if `COALESCE` short-circuits before the second parameter is fetched — not
something to rely on.

**Fix:** branch on `TG_OP` and read `OLD` only for `DELETE`, `NEW` otherwise.

### A3 · BLOCKER — subscription discount coupon can never be applied

`07-commerce-logic.md §8.2` specifies a system coupon `SUB-<pct>` kept "hidden `is_active`".
The RPC looks coupons up with `where code = p_coupon_code and is_active` — an inactive coupon
raises `COUPON_INVALID`. The renewal engine can therefore never apply the subscription discount.

**Fix:** add `coupons.is_system boolean not null default false`. System coupons stay
`is_active = true` and are excluded from `/offers` and from the admin coupon list by
`is_system = false`. "Hidden" means hidden from listings, not deactivated.

### A4 · BLOCKER — `prevent_role_escalation` blocks the service role

`03-database.md §3`. The guard raises unless `has_any_role('{admin}')`, which resolves through
`auth.uid()`. Under the service role `auth.uid()` is `NULL`, so the check fails and the trigger
raises. This breaks both flows that need it:

- admin team invite (`06-admin-pages.md §15`, "creates auth user via service + role"), and
- the production bootstrap `update profiles set role='admin' …` (`11-seed-data.md §2`).

**Fix:** exempt the service role explicitly —
`if new.role is distinct from old.role and auth.uid() is not null and not has_any_role('{admin}')`.

### A5 · `payment_status` diverges from `payments.status` depending on who marks an order delivered

`03-database.md §8`. `orders_before_status_change` is **not** `security definer`, so its
`if exists (select 1 from payments …)` runs under the caller's RLS. The `payments` read policy
grants `support` but **not** `warehouse_manager`. When a warehouse manager marks an order
delivered the `EXISTS` returns false, `orders.payment_status` stays `pending`, while the
`security definer` after-trigger still flips `payments.status` to `paid`.

**Fix:** the before-trigger no longer inspects `payments`; the after-trigger (already
`security definer`) owns both writes, deriving `payment_status` from the same query that updates
the payment row.

### A6 · `check_rate_limit` bucket is wrong for any window ≥ 1 hour

`03-database.md §8`. The window start is derived from `extract(minute from now()) % window_minutes`.
`extract(minute …)` only ever returns 0–59, so for a 1-day window (`1440` minutes) the modulo is a
no-op and the bucket collapses to _the current hour_. `02-architecture.md §9` specifies
"review create (5/d)" — that limit is silently enforced as 5/hour.

**Fix:** bucket on absolute epoch —
`to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window))`.

### A7 · `on_hand`/ledger invariant is unenforceable as specified

`07-commerce-logic.md §11` and `09-quality-testing.md §1` require `on_hand` to equal the sum of
`stock_movements` for that variant. Nothing in the schema seeds an opening movement, so any stock
set directly (seed, migration, admin inline edit of `on_hand`) breaks the invariant immediately.

**Fix:** opening balances are written as `received` movements, and `inventory_levels.on_hand` is
never set directly outside the four sanctioned paths. The invariant becomes a testable property
rather than an aspiration.

---

## B. Security

### B1 · BLOCKER — order numbers are sequential and the success page keys on them

`03-database.md §2` generates `SH-{year}-{000001…}` from a plain sequence.
`05-customer-pages.md §12` renders order contents at `/checkout/success/[orderNumber]`, which for
guests must be read with the service client. Anyone can walk `SH-2026-000001 …` and read every
order: name, address, phone, items, totals.

**Fix (both):**

1. The RPC returns a random `access_token` (stored on the order, 32 bytes base64url). The success
   page requires it — set as a short-lived (30 min) `httpOnly` cookie by `placeOrder`, never in the
   URL. Without it the route redirects to `/order-lookup`.
2. Order numbers keep a human-readable sequential form (operations need it) but gain a
   4-character random suffix: `SH-2026-000123-K7QW`. Enumeration alone no longer yields a valid
   number.

### B2 · BLOCKER — the `cost_cents` protection is a no-op, and margins are readable by every customer

`03-database.md §9`:

```sql
revoke select (cost_cents) on product_variants from anon, authenticated;
grant  select (cost_cents) on product_variants to authenticated;
```

Two independent problems:

1. Supabase grants `select` on public tables at **table level**. A column-level `REVOKE` cannot
   subtract from a table-level grant — Postgres emits
   `WARNING: no privileges could be revoked for column "cost_cents"` and access is unchanged.
   The revoke does nothing.
2. Even if it worked, line 2 immediately grants the column back to `authenticated` — i.e. to every
   registered customer. Doing it correctly (revoke table-level, re-grant an explicit column list)
   would instead break every `select *` the storefront issues.

**Fix:** move cost out of the customer-readable table. New table
`product_variant_costs (variant_id pk, cost_cents, currency, updated_at)` with staff-only RLS.
`select *` on `product_variants` stays safe by construction, and margin data has a real boundary
instead of a documented "acceptable v1 tradeoff".

### B3 · Verified-purchase reviews can be forged

`03-database.md §9`: `create policy p_insert_own on reviews for insert with check (user_id = auth.uid())`.
`reviews.order_id` is unconstrained, and `05-customer-pages.md §3` renders a "verified purchase"
badge whenever it is set. Any authenticated user can attach an arbitrary `order_id` and earn the badge.

**Fix:** the `with check` additionally requires the order to belong to the author _and_ to contain
the product:

```sql
order_id is null or exists (
  select 1 from orders o join order_items oi on oi.order_id = o.id
  where o.id = reviews.order_id and o.user_id = auth.uid() and oi.product_id = reviews.product_id)
```

### B4 · `support` can delete coupons; nobody can create loyalty coupons

`03-database.md §9`: `create policy p_staff on coupons for all using (has_any_role('{support,product_manager}')) with check (has_any_role('{admin}'))`.
`USING` gates `SELECT`/`UPDATE`/`DELETE`; `WITH CHECK` only gates the _new_ row. So support and
product managers can **delete** coupons (contradicting `06-admin-pages.md §11`, "Deactivate ≠ delete
once redeemed"), while `redeemLoyalty` (`07-commerce-logic.md §9`) cannot create the customer's
`LOY-XXXXXX` coupon at all, because customers hold no coupon write privilege.

**Fix:** split into `for select` (support, product_manager) + `for all` (admin), and implement
`redeemLoyalty` as a `security definer` RPC `redeem_loyalty_points(p_points int)` that deducts
points, writes the ledger row and mints the single-use coupon atomically.

### B5 · Three required write paths have no policy and are not on the service-role allowlist

`03-database.md §9` leaves `newsletter_subscribers`, `contact_messages` (insert) and `audit_logs`
(insert) policy-free — correct as a default-deny, but `02-architecture.md §6` restricts the service
client to "webhooks, cron, guest-cart, guest order lookup, email dispatch". So
`subscribeNewsletter`, `submitContact` and _every audited admin mutation_ have no legal way to write.

**Fix:** prefer `security definer` RPCs over widening the service-role allowlist —
`newsletter_subscribe(email, locale, source)`, `contact_submit(...)`, and
`log_audit(action, entity_type, entity_id, before, after)` (the last asserting `is_staff()` or
`admin` internally). The service-role table in `02-architecture.md §6` is left unchanged.

### B6 · Staff `UPDATE` on `orders` is unrestricted by column

`p_staff_update on orders for update using (has_any_role('{support,warehouse_manager}'))` permits
support to rewrite `total_cents`, `subtotal_cents` or `coupon_id` on a placed order.

**Fix:** a `before update` trigger rejects changes to the money columns, `order_number` and
`user_id` for any non-`admin` caller. Money is set once, by the RPC.

### B7 · Exact stock levels are world-readable

`p_wh_read on inventory_levels for select using (true)`. The doc's own comment says the UI should
expose only "in stock / low", but the policy lets anyone query precise counts for the whole
catalog — a competitor's sales tracker.

**Fix:** revoke public read on the table; expose `v_product_stock` (`security_invoker = off`,
staff-safe) returning only `variant_id` and a bucketed `stock_status` of
`in_stock | low | out_of_stock`. Storefront reads the view; staff read the table.

### B8 · Extensions installed into `public`

`create extension citext / pg_trgm / unaccent` with no schema puts their functions and operators in
`public`, where `anon` holds `usage`. This is what the Supabase linter flags as `extension_in_public`.

**Fix:** `create schema if not exists extensions; create extension … with schema extensions;` and
schema-qualify (`extensions.citext`, `extensions.unaccent`, `extensions.gin_trgm_ops`).

---

## C. Accessibility — the token palette misses its own AA floor

`CLAUDE.md §12` and `01-product-overview.md §4` mandate WCAG 2.1 AA. Three tokens in
`04-design-system.md §3`/`§10` do not meet it. Contrast computed per WCAG 2.x relative luminance
against `--color-cream #FAF9F5`; the values below are asserted by a unit test
(`tests/unit/contrast.test.ts`) so the palette cannot regress.

| Token / usage                                           | Spec value | Measured   | Required        | Verdict |
| ------------------------------------------------------- | ---------- | ---------- | --------------- | ------- |
| `ink-400` as eyebrow + meta **text** (`§6` ProductCard) | `#8B948E`  | **2.96:1** | 4.5:1           | ✗ fails |
| `line` as **input / control border** (`§5`)             | `#E6E8E4`  | **1.17:1** | 3:1 (SC 1.4.11) | ✗ fails |
| `lime-500` as the **focus ring** (`§10`)                | `#A3E635`  | **1.43:1** | 3:1 (SC 1.4.11) | ✗ fails |

The focus ring is the worst of the three: the pack mandates a lime focus indicator on every
interactive element, and lime-on-warm-white is very nearly invisible — a keyboard user cannot see
where they are.

**Fix — three additive tokens, no existing token changes meaning:**

| New token             | Value                  | Contrast on cream | Replaces                                                 |
| --------------------- | ---------------------- | ----------------- | -------------------------------------------------------- |
| `--color-ink-500`     | `#6B746F`              | **4.58:1**        | `ink-400` for eyebrows, meta, captions, helper text      |
| `--color-line-strong` | `#767F79`              | **3.92:1**        | `line` on inputs, checkboxes, radios, segmented controls |
| `--color-focus`       | `#245741` (forest-700) | **7.92:1**        | the outline half of the focus ring                       |

`ink-400` is retained for genuinely decorative and disabled-state use only; `line` is retained for
decorative dividers, where SC 1.4.11 does not apply.

**Focus ring composition** (keeps the brand, passes the SC): a 2 px `--color-focus` outline at
2 px offset carries the contrast, with a 4 px `lime-400` halo outside it carrying the brand.
Single-token lime rings are not used anywhere.

Also noted, not a failure: `forest-500 #3B8465` on `forest-50` is 4.13:1 — fine for icons and
graphics (3:1) but **not** for text. `04-design-system.md §7` only specifies it for line
illustrations, which is correct; it must not migrate to labels.

---

## D. Gaps — specified behaviour with no implementation path

| #   | Gap                                                                                                         | Source               | Resolution                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `search_products` is referenced as the single PLP/search query but never defined                            | `05 §2`, `12 M3`     | Defined in M1 as a `stable` SQL function taking filters + keyset cursor, returning products with facet-ready columns                                                              |
| D2  | Webhook idempotency requires a unique index on `payments.provider_ref`                                      | `07 §6.3` vs `03 §6` | `create unique index payments_provider_ref_key on payments (provider_ref) where provider_ref is not null`                                                                         |
| D3  | `reviews.helpful_count` has no sync trigger; `review_votes` is the source of truth                          | `03 §7`              | Trigger on `review_votes` maintains the counter                                                                                                                                   |
| D4  | Loyalty clawback on refund is specified but has no trigger or action                                        | `07 §9`              | `refunds` after-insert trigger writes the negative ledger entry, floored at the available balance                                                                                 |
| D5  | `cart_items.quantity` hard-codes `between 1 and 20` while `settings.checkout.max_item_qty` claims to own it | `03 §6`, `11 §1`     | Constraint kept as an absolute ceiling; the setting may only tighten it, enforced in the cart action. Documented as intentional                                                   |
| D6  | `subscriptions.discount_pct` is customer-writable through `p_own for all`                                   | `03 §9`              | Column made non-user-writable by trigger; the discount comes from the system coupon (A3)                                                                                          |
| D7  | RLS policies call `auth.uid()` / `has_any_role()` per row                                                   | `03 §9`              | All policy predicates wrapped as `(select auth.uid())` / `(select has_any_role(…))` so the planner hoists them to an InitPlan — a large win on `orders`, `order_items`, `reviews` |
| D8  | Three Vercel crons are specified; the Hobby plan allows two, daily-only                                     | `10 §5`              | Vercel **Pro** is required by M9. Recorded in `runbooks/deploy.md §6`                                                                                                             |
| D9  | `robots.txt` advertises `/sitemap.xml`, which `08 §4` specifies but nothing created                         | `08 §4`              | `app/sitemap.ts` added — 176 URLs with hreflang pairs, degrading to static routes if the catalog read fails                                                                       |
| D10 | The footer newsletter form posts to `/api/newsletter`, which did not exist                                  | `05 §17`, `08 §5`    | Route added, rate-limited and honeypotted. The double-opt-in _email_ is still M8; the row and token are written now so nobody is silently dropped                                 |
| D11 | `/api/health` is required by the uptime monitor but was never specified as a route                          | `10 §6`              | Added. Reads through the **anon** client, so a healthy response proves the path customers use — not merely that Postgres is up                                                    |

---

## G. Additions made during implementation

New, not corrections. Each earns its place.

### G1 · A fourth Supabase client: `lib/supabase/public.ts`

`02 §6` defines three clients. A fourth is needed because `server.ts` reads `cookies()`, and
touching `cookies()` opts the caller into **dynamic rendering** — fatal for exactly the
places that must be static: `app/sitemap.ts`, `generateStaticParams` for PDP/PLP/article
routes, and any build-time prerender of catalog content (`02 §5`).

It is anon-key and session-less, so it is strictly _less_ privileged than the server client —
it can only read what an anonymous visitor can read, and is therefore not an escalation
seam. Never for writes, never where the current user matters.

### G2 · Integration fixtures are purged automatically

The suite created brands, products, variants, stock, carts and orders but cleaned up only
auth users. Run against the hosted dev project it left **63 published fake products** behind,
which appeared in `sitemap.xml` and would have appeared on the storefront.

`tests/integration/purge.ts` plus a Vitest `globalSetup` teardown now remove them **pass or
fail** — chaining cleanup with `&&` would skip it precisely when a run failed and leaked
most. Matching is restricted to the fixture naming conventions (`slug LIKE 'product-%'`,
`'brand-%'`, emails `LIKE '%@shneta.test'`, orphaned `LOY-` coupons), so it cannot touch real
content, and it refuses the production hostname outright. `pnpm purge:test-data` is the
manual escape hatch.

### G3 · Sentry's browser SDK is lazy-loaded

A static `import * as Sentry from '@sentry/nextjs'` in `instrumentation-client.ts` puts the
whole browser SDK into the shared First Load JS chunk of every route — measured at **+84 kB,
taking the shell from 120 kB to 204 kB** against the 170 kB budget in `09 §3`. A dynamic
import moves it to an async chunk: nothing ships without a DSN, and with one the cost lands
after first paint. Server and edge Sentry cost the client nothing and catch the errors that
threaten order integrity.

Session Replay stays off: it records form fields, so it would capture addresses and payment
intent at checkout, against the data minimisation in `01 §4`.

---

## H. What the first real database push taught us

Everything in §A–§D was found by reading. This was found by Postgres, and it records a class
of bug that no amount of reading catches.

**`has_any_role()` was defined before the table it queries.** It sat in migration 01 and
reads `profiles`, created in migration 02. Postgres parses and validates a **`language sql`**
function body at `CREATE` time — unlike `plpgsql`, which defers to first call — so the push
aborted on the very first file with `relation "profiles" does not exist`.

Fix: the three role helpers moved into migration 02, immediately after `profiles`.

`check:sql` gained **check 7** for exactly this shape — a `language sql` function reading a
table created in a later migration — verified against a deliberately reintroduced canary.

The lesson generalises: **offline structural checks catch shape, not semantics.** Only a real
database proves a migration applies, which is why `pnpm test:integration` is the acceptance
gate for M1 and `pnpm check:sql` is not.

---

## I. What driving the checkout in a browser taught us

§H was found by Postgres. Everything here was found by clicking through the money path with
Playwright and axe. Each of these passed typecheck, lint, unit tests and the integration
suite; none of them would have been found by reading the code again.

### I1 · BLOCKER — coupon codes were case-sensitive despite being `citext`

Typing `welcome10` for a coupon printed as `WELCOME10` returned "that coupon isn't valid".

`coupons.code` is `extensions.citext` and PostgREST matches it case-insensitively, so this
looked right from the app. Inside `checkout_create_order` it was not. The function was
declared `set search_path = public`. The `::extensions.citext` casts resolved, being
schema-qualified — but the `=` **operator** for citext also lives in `extensions`, and an
operator cannot be schema-qualified inside an expression. With `extensions` off the
search_path Postgres could not see `=(citext, citext)`; because citext is binary-coercible to
text it silently resolved `=(text, text)`. No error, no warning, no log line: the comparison
just quietly became case-sensitive.

Phone keyboards capitalise, autocorrect lower-cases, and coupons are printed on flyers in
caps. This would have produced a steady trickle of "the code doesn't work" with nothing in the
logs to explain it.

Fixed by migration `20260731001300_citext_search_path.sql` — an `alter function … set
search_path = public, extensions` rather than a `create or replace`, so the 200-line body is
not duplicated to change one parameter. Pinned by an integration test that deliberately
lower-cases the code, and by `e2e/checkout.spec.ts`, which types `welcome10`.

**Generalises to:** every function that compares a citext column needs `extensions` on its
search_path. `triggers.sql` and the search RPC already did, for `unaccent` and `pg_trgm` — the
checkout RPC was the one that missed it.

### I2 · Six of thirty SKUs were unbuyable

The M3 PDP rendered variants as inert `<span>`s with a "interactive selection lands with M4"
note, and `AddToCart` was hard-wired to the **default** variant. So the 240-count D3, the
634 g creatine, the vanilla whey, the 200-count omega-3 and the green shaker could be looked
at and not bought. `on-gold-standard-whey` was worse than that: its default is the 900 g, but
had the out-of-stock 2.27 kg been the default the product would have been a dead end.

Replaced by `BuyBox` — one real `<form>` holding price, variant radios, stock line and the
submit. Any variant is purchasable **before hydration**, because the radios post; the price
and stock line follow the selection with no request, because every variant's data already
arrived with the page; and the PDP stays statically renderable. Encoding the selection in
`?variant=` would have read `searchParams` and made every PDP dynamic — losing ISR on the
most-visited route type to save a few lines of state.

### I3 · `SubmitButton` disabled its own double-submit guard

```tsx
<Button disabled={pending || props.disabled} {...props}>   // ← spread wins
```

The spread came last, so any caller passing `disabled={false}` — the add-to-cart button,
whenever the variant is in stock — overwrote the pending state and left the button live for
the whole round trip. Double-clicking added the item twice. `disabled` is now destructured out
and recombined after the spread, and `e2e/checkout.spec.ts` double-clicks add-to-cart and
asserts a quantity of 1.

Checkout's Place-order button was accidentally safe: it passes no `disabled` prop, so the key
was absent from the spread. It was one prop away from taking two orders.

### I4 · Four redirects dropped the locale

`redirect('/cart')` from `/en/checkout` lands on the **Albanian** cart. The same bug the
sign-in action's `localizedRedirect` was written for, in four more places: empty-cart checkout,
both order pages' access-gate misses, and the account layout's sign-in bounce. All four now go
through `localizePath`, and the empty-cart case is asserted in E2E against `/en/cart`.

### I5 · ink-500 on the forest-50 tint misses AA by 0.07

axe measured **4.43:1** on the checkout payment card's body text; AA wants 4.5. §C had
verified ink-500 against `cream` (4.53:1) and stopped there — but `forest-50` is the tint on
every selected card and filled panel, and it is a hair darker. The rule is now **secondary
text on a tint is ink-600, never ink-500** (6.22:1), and `tests/unit/contrast.test.ts` asserts
both halves: that ink-600 passes on forest-50, and that ink-500 fails, so the rule fails a test
rather than waiting to be rediscovered in a browser.

### I6 · Order lookup cleared both fields on every failure

People reach order lookup _because_ they are unsure of a 20-character order number, and the
usual failure is one wrong character — so wiping both fields meant retyping everything to fix
a digit. `LookupState` now carries the submitted values back (truncated before they re-enter
the DOM, since on a schema failure they are arbitrary strings) and the inputs repopulate.

### I7 · Two test suites quietly shared a rate-limit budget

`checkout.spec.ts` allocated itself forwarded addresses in `198.51.100.0/24` — the block
`auth.spec.ts` reserves for the one test that needs to own a budget outright. The checkout
tests spent `198.51.100.2` before the mobile rate-limiter test ran, and it failed on an empty
budget. The suite-wide allocation is now written down at the top of `checkout.spec.ts`:
TEST-NET-3 for auth's per-test addresses, TEST-NET-2 for its fixed ones, TEST-NET-1 for
checkout.

### I8 · E2E checkout drains fixture stock

The journeys buy from the real seeded catalogue — there is no way to place a believable order
otherwise — so every run decremented `on_hand` for real variants. Left alone, the suite would
have worked for a dozen runs and then failed because `NOW-D3-120` reported out of stock.

`purgeFixtures` now writes a compensating `cancel_restock` movement through
`apply_stock_movement()` before deleting a test order, and `e2e/global-teardown.ts` runs it
after every Playwright run, pass or fail. Compensating rather than deleting the `sale` rows,
because deleting a movement without touching `on_hand` creates exactly the drift
`v_stock_ledger_drift` exists to catch, and touching `on_hand` directly is what §A7 forbids.
Four consecutive full runs now come out at 116/116.

---

## J. What building the admin panel taught us

§I was found by driving the checkout. These were found by building the thing that operates on
what the checkout produces.

### J1 · Server Components cannot hand a client component a React component

Passing Lucide icons as props from the admin layout to the sidebar took the **entire `/admin`
tree** down to the global error page. A component serializes to
`{$$typeof, render, displayName}` and React refuses it: _"Functions cannot be passed directly to
Client Components."_

Icons are now resolved client-side from a string name (`features/admin/components/nav-icon.tsx`),
which also turned `roles.ts` into pure data. The rule generalises: **anything crossing that
boundary must survive `JSON.stringify`** — no components, no functions, no class instances.

### J2 · A second root layout needs its own `<html>`/`<body>`

There is no `src/app/layout.tsx`. The storefront's root is `app/[locale]/layout.tsx`, because
every storefront route is localized, which makes `app/admin/layout.tsx` an **independent root**.
It shipped without `<html>`/`<body>` and every admin page rendered as the error page.

### J3 · `SubmitButton` disabled its own double-submit guard

```tsx
<Button disabled={pending || props.disabled} {...props}>   // ← the spread wins
```

Any caller passing `disabled={false}` — the add-to-cart button, whenever the variant is in
stock — overwrote the pending state. Checkout's Place-order button was safe only by accident, by
passing no `disabled` prop at all. `disabled` is now destructured out and recombined after the
spread. **Prop-spread order is a correctness concern, not a style one.**

### J4 · Seven distinguishable status colours, from an existing palette

The status badges first reached for `bg-[#dbeafe]`-style hex to get enough hues — exactly the
arbitrary-palette drift CLAUDE.md §9 forbids. Solid semantic fills (`warning`, `success`, `error`,
`info`, `forest-800`, `ink-600`) with white text give the same separation, and all six are now
asserted in `tests/unit/contrast.test.ts`. Adding a failing tone is a test failure rather than
something axe finds later on a page that happened to be sampled.

The related rule, learned twice: **a `/15` tint of a semantic colour is not a safe background for
that colour as text.** It put the environment badge at 4.08:1 (§I5) and it will do it again.

### J5 · `ink-400` was being used for real text

The SKU line under every order item — 2.96:1 at 12px. `ink-400` has been documented as
below-AA and decorative-only since M0, and this is a SKU a customer reads out to support.

It survived M4 because **axe never reached the component**. The a11y smoke covers the cart and
checkout; the success page needs an access cookie, so nothing exercised `OrderSummary` until the
account order page gave it a reachable home. The durable fix is that coverage, not a lint rule:
a token can be documented as unsafe and still be used if nothing looks.

### J6 · Two types describing one order

`OrderSummary` is shared by the checkout success page, guest lookup and the account — but it
would not accept `OrderDetail`, because `OrderView` had typed its address as
`Record<string, string | null>` while `OrderAddress` uses optional fields. `ORDER_STATUSES` and
`toOrderStatus` were also declared twice, both mirroring one Postgres enum.

Fixed by declaring what the **component** needs (`OrderSummaryData`) rather than making one order
type a subset of the other, so both keep their own fields and neither has to widen.

### J7 · Two test assertions that were about the wrong thing

Both passed alone and failed in the full suite, and neither was flakiness to retry away:

1. **"Cancelling returns stock"** compared `inventory_levels.on_hand` before and after. The
   checkout journeys buy the same SKU concurrently, so a global counter moves under the test. It
   now asserts the `cancel_restock` **movement referencing that order id** — order-scoped, and
   the stronger claim anyway, since docs/07 §11 makes the ledger the authority and `on_hand` its
   derivative.
2. **"A new order appears in the confirmation queue"** — the queue holds the ten _oldest_ pending
   orders, and other specs create pending orders concurrently. It now asserts the queue is
   populated and can be worked from, and follows the link.

The generalisation: **an assertion about globally-shared, concurrently-mutated state is a bug in
the test, not an unlucky ordering.** Scope the claim to the entity under test.

### J8 · A per-assertion timeout equal to the per-test timeout can never fire

`ACTION_TIMEOUT` was 30 s and Playwright's default per-test timeout is also 30 s, so a slow
assertion died with the test before spending its budget — and reported "element(s) not found",
which reads like a selector bug. Per-test is now 90 s. **A per-assertion deadline must sit well
inside the per-test one, or its failures lie about the cause.**

### J9 · Departure from spec: no chart library

docs/06 §1 specifies recharts for the dashboard charts. It is ~90 kB gzipped and must be a client
component, on a page whose job is to be glanced at, against a 170 kB route budget (docs/09 §3).

The 30-day series is a flex row of `div`s with computed heights, with the same figures in a
collapsible `<table>` beneath — so the page ships **no JavaScript**, `/admin` builds at 829 B, and
screen readers get the data rather than a canvas. Revisit if a chart ever needs interaction.

---

## K. What journey 8 found

The catalogue milestone's acceptance test is "create a product, approve it, see it on the
storefront". Everything up to and including approval passed on the first run. The last step did
not, and the reason had been sitting in the codebase since M0.

### K1 · BLOCKER — tag-based revalidation was never wired up

`lib/cache.ts`, the `CACHE_TAGS` vocabulary and every admin action's `revalidatePublic` call
were all built as specified. They purged tags that **nothing had ever been tagged with**.

The catalogue reads used React's `cache()`, which dedupes within a single render and has no
relationship to the Next Data Cache, and the pages used a bare `export const revalidate = 300`.
`unstable_cache` appeared nowhere in `src/`. So the entire on-demand purge mechanism was
decorative: publishing a product left the storefront serving its previous state for up to five
minutes, and docs/02 §5's "instantly via tag purge" was not true of any page.

**Fix:** `getProduct` now wraps its fetch in `unstable_cache` keyed `['product', slug]` and
tagged `products` + `product:{slug}`, created per call so purging one product does not purge
all of them. React's `cache()` still wraps that — the two solve different problems, one
deduping within a render and one persisting across requests.

`listProducts` is tagged `products` with the filter set in its cache key — the PLP, category,
brand and goal pages all come through it with different arguments and must not share an entry.
Only the coarse tag, because a listing's contents depend on the whole catalogue and no per-slug
tag would correctly invalidate it.

The five taxonomy reads (`getCategoryTree`, `getCategoryBySlug`, `listBrands`,
`getBrandBySlug`, `listGoals`, and the two ingredient reads) share a `taxonomyCache` helper —
identical in shape, so the wrapping is factored out rather than pasted seven times. Before this,
`revalidatePublic([CACHE_TAGS.brands])` purged nothing and renaming a brand left its page stale
for the full window.

**Why nothing caught it earlier:** no unit or integration test could. The defect exists only
across the boundary between an admin write and a cached public read, which is precisely the
seam an end-to-end journey covers and nothing else does.

### K2 · A test that asserted something that could not fail

`getByText('Published')` matched **"Before this can be published"** — Playwright's string
matching is case-insensitive substring by default. The assertion passed while the approval had
silently done nothing, and the test then failed three steps later with a symptom that pointed at
caching.

That cost the most time of anything in M6, and the lesson is narrow enough to state: **for
status text, use `{ exact: true }`.** Substring matching against a page that also contains
explanatory prose will eventually match the prose.

### K3 · Publishing a product does not make it purchasable

Journey 8's final assertion is that the new product renders **and is out of stock**. That is not
a defect: receiving stock is `/admin/inventory`, which is M10. A product manager can today take
a product all the way to live and still not make it buyable.

Everything downstream behaves correctly — `v_product_stock` reports `out_of_stock` for a variant
with no inventory row, the BuyBox disables and labels the button, checkout would refuse it. The
assertion documents the boundary; the day inventory lands, it is what should change.

## L. What finishing the catalogue admin taught us

§K covers journey 8. This covers the rest of M6 — the four taxonomy screens, the compliance
queue and the editor's last three tabs.

### L1 · Four entities, one module, and a type error worth keeping

Brands, categories, health goals and ingredients are the same editing problem: a slug, a name,
some bilingual prose, an order, an on/off switch. They are built as one `taxonomy-actions.ts`
and one `TaxonomyAdmin` component, with the differences declared in `taxonomy-config.ts` rather
than branched on inside. Four near-identical files would drift — one would gain a duplicate-slug
message the others lack, one would forget to purge its tag.

The first version wrote all four tables through a shared `Record<string, unknown>` payload. That
compiles, and the generated database types refuse it. **The refusal was right**, and for the
exact reason this milestone had already learned the hard way: ordering categories by `position`
when the column is `sort_order` (§K, `getEditorOptions`) failed silently at runtime and cost an
afternoon. Four short `switch` branches with concrete payloads buy compile-time proof that every
column exists on the table being written. `as never` would have restored precisely the hole the
types were closing.

### L2 · Hiding a parent category silently rebuilds the menu

`getCategoryTree` attaches each node to its parent and treats the parentless as roots. RLS hides
an inactive category from anonymous reads. Put those together: switching off "Vitamins" does not
hide "Vitamin D" and "Vitamin C" — it **promotes them to the top level of the navigation**.
Nothing errors, nothing 404s, and the menu is quietly wrong.

The same shape one step further: setting a category's parent to one of its own descendants makes
every category in the loop attach to another loop member and none to a root, so the whole branch
disappears from the menu without a single error.

**Fix:** both are refused in `toggleTaxonomyActive` / `saveTaxonomy` with their own messages —
`hasChildren` and `categoryCycle`. Checked in the action rather than the database, deliberately:
they are workflow rules about what an operator may do next, not invariants the data must always
satisfy. An inactive category that still has products is a perfectly valid state to arrive at, by
unpublishing the products first.

### L3 · A queue whose items do not leave when you act on them

`approveProduct` supports approving without publishing, and an approved draft is a legitimate
state. Putting an "Approve only" button in the compliance queue looked like free functionality —
until the item stayed in the queue afterwards with no sign it had been dealt with, and the next
reviewer read it again.

Making it work needs a status the schema does not have: "approved, awaiting launch". Inventing
one in a UI component is not the place. The queue offers approve-and-publish or reject; the
product page, which shows the approval state directly, is where an approval without a publication
belongs. Noted in docs/14 rather than half-built.

### L4 · A writer with no reader is the same defect as a purge with no tag

The SEO tab writes `products.seo`. Nothing on the storefront read that column — page metadata
was derived from the name and subtitle — so shipping the editor alone would have produced a
form that appears to work and changes nothing an actual visitor sees.

That is §K1 wearing different clothes: `revalidatePublic` purging tags no read carried was
exactly a writer with no reader, and it survived two milestones. So the PDP's `generateMetadata`
now prefers the override and falls back to the derived copy, in the same change. **Ship the
reader with the writer, or ship neither.**

The same rule is why `categories.image_path`, `health_goals.image_path`, the `seo` column on the
four taxonomy tables and lab-report uploads are _not_ in this milestone: no component renders
them yet. Brand logos are, because `readBrands` and `getBrandBySlug` do.

### L5 · Departure from spec: numbers instead of drag-and-drop

docs/06 §4 asks for a category tree with drag-reorder and reparent, and §7 for reorderable goal
tiles. Both ship as a plain `sort_order` number field and a "sits inside" select.

It is less pleasant and it works without JavaScript, is unambiguous over a hierarchy, and gets
the catalogue enterable now. The drag interaction can replace it later without changing a single
column. What would have been unacceptable is shipping the _data_ wrong to get a nicer control.

### L6 · The label posts as one JSON field

`product_ingredients` rows are composite — ingredient, amount, unit, %NRV, per-serving. FormData
can carry repeated keys, but reconstructing rows from five parallel arrays depends on those
arrays staying index-aligned, and **a browser omits an unchecked checkbox entirely**, which
breaks exactly that alignment: uncheck "per serving" on row two and rows three onward silently
shift. One JSON field has no such failure mode.

The write is delete-then-insert rather than upsert, because the submission is the complete label
and an ingredient the operator removed has to disappear. The two statements are not in one
transaction — PostgREST has none — so a failure between them leaves the label empty rather than
half-wrong. That is the better failure: an empty ingredient table is obviously broken and gets
re-saved, whereas a silently merged one looks correct.

The same fact bit the taxonomy editor in a quieter way: `isActive: z.coerce.boolean().default(true)`
meant an unticked "visible on the storefront" box — absent from the payload — was read as
"unspecified" and defaulted back to `true`. Every save silently re-activated the row, and the
only way to hide anything was the separate Hide button. **For a checkbox that is always
rendered, absent means unchecked, and a schema default is the wrong tool.**

### L7 · The eighth taxonomy read, still untagged

§K1 wrapped seven catalogue reads in `unstable_cache`. `getGoalBySlug` sat immediately below
them, written the same way, and was missed — because §K1 was found by a _product_ journey.
Nothing in the suite edited a health goal, so nothing could observe the goal page staying stale.

M6 makes goals editable in the panel, which is exactly what turns a missed tag into "I renamed
it and the site still shows the old name" for five minutes at a time. Now wrapped like the other
seven, and `an edit to a brand reaches the storefront immediately` is the test that would catch
the class — a taxonomy edit observed from the storefront, which nothing did before.

`listFeaturedProducts` is deliberately left as a plain `cache()`: it delegates to `listProducts`,
which is tagged, so the persistent layer is already covered.

### L8 · An assertion that the test itself satisfies

`await expect(page.getByRole('cell', { name: 'After Rename' })).toBeVisible()` — meant to wait
for a save to land — passed the instant the operator's own keystrokes did. The editor renders
inside a `<td>`, and **the accessible name of a table cell includes the values of the inputs
inside it**. The wait returned before the Server Action had even been dispatched.

Everything after it then read a row that had not changed yet, and the failure surfaced three
steps later as an apparently stale storefront. That sent an hour into the cache layer — building
purge probes, comparing route-handler and Server Action invalidation, reading the Data Cache
semantics — for a defect that was never there. The tell, in hindsight: a standalone probe of the
same purge worked every time.

**The rule:** an assertion that can be satisfied by what the test just typed is not an
assertion. For a Server Action, the signal that it finished has to come from the database:

```ts
await expect.poll(async () => (await db().from('brands').select('name')…).data?.name)
  .toBe('After Rename');
```

Same family as §K2 — there, a substring matched explanatory prose; here, a locator matched the
input's own value. Both let a test pass while the write did nothing, and both cost far more to
diagnose than the code they were guarding.

### L9 · A tester's typo that accuses the code

The rejection test asked for `audit_logs.changes`. The column is `before` / `after`. PostgREST
answers an unknown column with an **error and a null body**, and `data ?? []` turns that into a
confident empty array — so the test reported "a rejection must be audited: expected 1, received
0" while the audit row sat in the table.

Every query in a test that concludes "the row is missing" now asserts `error` is null first.
The third instance in this codebase of a swallowed Supabase error changing the meaning of a
result (see §K, `getEditorOptions`), and the reason `admin-queries.ts` logs each failure.

---

## M. What building reviews, wishlist, search and compare taught us

### M1 · BLOCKER (pre-existing) — the storefront has never been statically rendered

`docs/02 §5` describes the catalogue as static with ISR and on-demand tag purging, and §K1
fixed the second half of that. The first half has never been true.

`Navbar` calls `getCartItemCount()`, which reads `cookies()`. It is rendered by the storefront
**layout**, and a request-scoped API in a layout opts every page beneath it into dynamic
rendering. So since M4, `/`, `/shop`, every category, brand, goal, ingredient and product page
has been server-rendered per request. The build output still says `● (SSG)` and lists prerendered
paths, which is what made it invisible — but `.next/server/app` contains **seven** `.html` files,
all of them auth pages, and a product page answers with
`cache-control: private, no-cache, no-store`.

**What still works:** the Data Cache. `unstable_cache` entries are shared across requests and
`revalidateTag` purges them, which is why §K1's fix is real and why the brand-rename test passes.
Database reads are cached and correctly invalidated.

**What does not:** the Full Route Cache. Every visit re-runs the React render even when nothing
changed, and `revalidate = 300` on those pages currently means nothing.

**Not fixed in M7**, deliberately: the fix is to make the cart badge a client component that
fetches its count after mount, which changes the navbar's contract and wants its own change and
its own verification. It is listed in docs/14 §10 as the first thing to do in M11's performance
pass — and it is worth doing, because it converts every catalogue page from a render into a file.

The lesson is narrow and worth stating on its own: **a layout is the most expensive possible
place to touch `cookies()`.** M7 nearly repeated it — the first version of `WishlistProvider`
took `isSignedIn` as a prop and the layout supplied it with `getCurrentUser()`. One line, and it
would have re-committed the same mistake in the same file. The provider fetches its own state
after mount instead.

### M2 · A cached page cannot carry per-viewer state

The PDP renders reviews. Three things about a review are per-person: whether you voted it
helpful, whether you wrote it, and whether you may write one at all. None of them can be part of
a shared cache entry, and reading the session to compute them would have made the page dynamic —
the §M1 trap again, one component further in.

So the split is explicit: `listProductReviews` uses the **anonymous public client** and returns
exactly what a logged-out visitor may see, which is also what belongs in cached HTML and in
search-engine results. `loadReviewContext` is a server action the client calls after mount, and
it returns only the caller's own state.

The same shape serves the wishlist: hearts render unfilled in the cached HTML and fill in when
the provider's single request resolves.

### M3 · A `'use server'` file may export only async functions

`export const MIN_QUERY_LENGTH = 2` next to the search action is a **build error**, not a lint
warning — every export of a `'use server'` module becomes a POST endpoint, and a constant cannot
be one. It moved to `features/search/constants.ts`.

Worth recording because the failure arrives from webpack at build time with no hint that a plain
constant is the problem, and the same file happily exports `interface` and `type` (both erased).

### M4 · Departure from spec: no Articles tab in search

docs/05 §8 specifies three result groups — products, articles, ingredients. Articles are absent,
because `/knowledge/[slug]` arrives with M8 and an article result today would be a link to a 404.
Ingredients take the second slot; they have real pages, and a shopper typing "magnesium" is often
looking for the ingredient rather than one product.

Same rule as the lab-report uploads left out of M6 (§L4): **a surface with no destination is
worse than a missing surface**, because the missing one is obvious and the broken one is not.

### M5 · Departure from spec: no "approve without publishing" in the compliance queue

Carried over from §L3 and repeated here for the review queue, where the same question came up
and got the same answer: an item that stays in a queue after you act on it is broken. The review
queue's three verbs all remove the review from the pending tab.

### M6 · Price per serving refuses to guess

docs/05 §9 asks the comparison table for a computed price per serving. Nothing in the schema
stores a pack count — `serving_size` is free text an editor typed. `servingsFrom` looks for a
number followed by "per pack" or "për paketë" and returns `null` otherwise, which renders as "—".

A guess would be worse than a blank, and not marginally: price per serving is _the_ number a
shopper uses to decide which of two products is cheaper. One derived from a misparsed label is
not a rough answer, it is a confident wrong one. The unit test pins both halves, including that
a pack size of zero yields `null` rather than a division by zero.

### M7 · Fixture reviews change a seeded product's rating

`purgeFixtures` deletes reviews belonging to fixture **products** (`slug LIKE 'product-%'`).
Journey 6 reviews a **seeded** product, because that is what a customer buys in the checkout
helper — so its reviews fell outside the sweep, and every run would have left the demo catalogue
a little more highly rated by nobody.

They are cleaned up by the auth-user deletion that already runs: `reviews.user_id` and
`wishlist_items.user_id` both cascade from `profiles`, and deleting a review fires
`refresh_product_rating`, so `rating_avg` returns to what it was. The comment now says so, since
the connection between "delete the test user" and "restore the catalogue's ratings" is not one
anybody would reconstruct from the code.

That was the analysis. It was also wrong about one thing, and finding out how is §M9: the
auth-user deletion this depends on had never once succeeded.

### M8 · The third instance of an assertion about a shared list

Journey 6 wrote a review titled "Does what it says" and asserted, from a logged-out context,
that it was **not** visible before approval. On desktop it passed. On mobile it failed — because
the two projects run concurrently against one database, and the mobile run's shopper was seeing
the desktop run's _approved_ review.

Read literally, the failure said a pending review is public. It is not; the test was.

Same shape as the compliance queue in §L (fixtures named identically) and as §K2 and §L8
(assertions that could not fail). The rule that covers all four: **anything asserted against a
list the whole suite shares must be identified uniquely** — and where the assertion is that
something is _absent_, that is not a nicety, it is the difference between a passing suite and a
reported security hole that does not exist.

### M9 · BLOCKER — the fixture purge had never deleted a single user

`pnpm purge:test-data` reported "nothing to purge" against a database holding **580** fixture
profiles. It had been failing since M5 and saying nothing.

Eleven tables reference `profiles(id)` with no ON DELETE clause — `audit_logs.actor_id`,
`products.approved_by`, `stock_movements.created_by` and eight more. In Postgres that means
NO ACTION, a restriction. Deleting an auth user cascades to its profile, the first of those
constraints refuses, the transaction aborts, and GoTrue returns a bare `500` that `supabase-js`
surfaces as an `AuthRetryableFetchError` whose `message` is `{}`.

The loop counted successes:

```ts
const { error } = await db.auth.admin.deleteUser(profile.id);
if (!error) deletedUsers += 1; // 580 errors, 0 counted, summary says "nothing to purge"
```

**Why it mattered beyond tidiness:** M7 reviews seeded products, and `reviews.user_id` cascades
from `profiles` — so the reviews stayed too. Six of them had pushed `now-vitamin-d3-4000` to
**4.0 stars from five reviews written by nobody**, on the live database, visible to anyone
browsing. A catalogue test then failed for the right reason and reported the wrong cause.

**Fix**, in two parts:

1. The FKs stay. An audit row that can lose its actor is not an audit row, and the same
   reasoning already protects `stock_movements` and `loyalty_transactions`. What was missing is
   that fixture _actors_ need the treatment fixture _ledgers_ already get: `audit_logs` rows for
   a fixture user are deleted (an audit trail of test activity is test data), and the other ten
   references are nulled — the row belongs to the shop, only the "who" was a fixture.
2. **The failure is now reported.** A purge that cannot delete its users has left the database
   dirtier than it found it, and the one thing it must not do is say so quietly. The count map
   gains an `auth users FAILED (…)` entry carrying the first error.

The second part is the more important one. The FK oversight is a day's worth of accumulated
rows; the swallowed error is why nobody noticed for three milestones. It is the fourth time in
this codebase that discarding a Supabase error changed the meaning of a result — see §K
(`getEditorOptions`), §L9 (the audit-column typo) and the original `data ?? []` sweep in §G2.

---

## N. What building the content layer taught us

### N1 · BLOCKER — the unsubscribe link would have unsubscribed anyone

docs/08 §5 asks for a **signed** unsubscribe link in every marketing email. The schema had
nothing to sign with: `confirm_token` is cleared the moment an address is confirmed, which is
right for a one-shot opt-in and useless for a link that must keep working for years.

The first version wrote `/newsletter/unsubscribe?email=…`, and it took writing the comment above
it to notice what that is: a URL that unsubscribes any address the sender knows. A competitor
with a customer list could empty the mailing list one request at a time, and **nobody would
report it**, because unsubscribing is exactly what an unsubscribe link is supposed to do.

Migration 16 adds a durable per-row `unsubscribe_token`, minted at insert and never cleared, and
`newsletter_unsubscribe(token)` to spend it.

The same migration fixes a race it uncovered: `newsletter_confirm` returned a boolean, so the
caller had to read the subscriber's address **before** spending the token in order to know where
to send the welcome email. Two clicks on the same link and the second one finds nothing. It now
returns the address and the unsubscribe token from the same statement that confirms.

### N2 · `create or replace function` cannot change a return type

Changing `newsletter_confirm` from `boolean` to `jsonb` stopped the migration mid-file with
`cannot change return type of existing function` — after the three statements before it had
already applied. `supabase db push` records nothing on failure, so the next run replays the
whole file.

Two things follow, and the second is the general one:

1. `drop function if exists` before a `create` that changes a signature.
2. **Write every migration so a partial application can be re-run**: `add column if not exists`,
   `create index if not exists`, `create or replace`. This one already was, everywhere except
   the statement that failed.

### N3 · Markdown is a security boundary, so it is unit-tested

Article bodies are markdown in a database several staff roles can write to. The alternative to
sanitising is stored XSS on every page of the Knowledge Center.

`MarkdownBody` starts from `rehype-sanitize`'s default schema and **narrows** it to the tags
docs/08 §3 lists, rather than replacing it. That matters: the default also strips the
attribute-level attacks — `javascript:` URLs, `on*` handlers, `style` — and re-deriving that list
by hand is how a sanitiser ends up sanitising less than it appears to.

Ten unit tests cover it, and the interesting ones are the cases no editor would type:
`<script>`, `onerror=`, `[click](javascript:alert(1))`, `<iframe>`. Also `# heading` in a body,
which is not an attack but is a real defect — the page already renders the title as its `<h1>`,
and two is a document-outline error. `h1` is absent from the allowlist, so a stray `#` degrades
to text.

### N4 · "Public coupon" is a question, not a row-visibility rule

`/offers` lists claimable codes. `coupons` is staff-read only, which is correct — the table
carries `max_uses`, internal notes and every system coupon.

An anon read policy was the obvious fix and the wrong one. "Public" here means _not system, and
active, and inside its window, and not exhausted_ — four conditions that every caller would have
to re-derive, and the first one to forget the window check puts an expired code on the page. That
is the single acceptance criterion docs/05 §11 states.

So it is `list_public_coupons()`, returning the four fields the page renders. The seeded
EXPIRED5 (deliberately `is_active = true`, window closed) and SUB-10 (`is_system`) make both
exclusions testable, and the E2E asserts neither appears.

### N5 · Departure from spec: no reply-from-the-panel in the contact inbox

docs/05 §16 asks for a contact form and an inbox; docs/06 lists neither page, though its
dashboard §1 has a "new contact messages" queue that until now linked nowhere. `/admin/messages`
is that destination.

Replies are sent from the operator's own mail client, and the panel records that one happened.
Building a send path would mean a second outbound identity to keep off the spam lists, and it
would thread worse than the mailbox the operator already reads. A shop this size answers a
handful of messages a day.

### N6 · Analytics ships as a gate with nothing behind it

docs/12 M8 asks for "cookie-consent banner + analytics events". The banner is real and gates
correctly; `lib/analytics.ts` is a no-op.

That is not laziness, and it is not a stub pretending to work. docs/10 never picks a provider,
and the choice between Plausible, Umami and GA4 changes the snippet, the event API and the
privacy notice. What is worth building before the choice is the **guarantee**: the module is
dynamically imported by `CookieConsent` and by nothing else, so a visitor who declines never
downloads it, let alone runs it. An analytics module imported at the top of a layout has already
executed by the time a banner renders, whatever the banner then does — which is the failure mode
this shape makes impossible.

### N7 · An alpha on a text colour is a new colour

The article-card cover placeholder used `text-forest-800/40` on the `forest-50` tint. It looked
like a style choice. It resolves to `#9bb0a7` on `#f0f7f3` — **2.1:1**, less than half the AA
floor — and axe found **233 instances** of it on one pass over the Knowledge hub.

The palette is pinned by `tests/unit/contrast.test.ts` precisely so a swatch cannot be darkened
back into a violation (docs/13 §C, §I5). That test reads _tokens_, so an opacity modifier walks
straight past it: `forest-800` passes, `forest-800/40` is a colour the test has never seen.

**Fixed** with the solid `forest-600` (5.79:1), and the rule is now asserted in both directions
— `forest-600` passes on the tint, `forest-500` does not — so the next person reaching for a
lighter green finds a failing test rather than a shipped violation.

The general lesson, and the reason this is written down rather than just fixed: **the contrast
suite guards tokens, and axe guards rendered pixels.** Neither is redundant. This one needed
both — the token test could not have caught it, and axe only runs on the pages the E2E suite
visits, which is why every new page in M8 got an axe assertion in the same commit.

### N8 · Two things fixed to the bottom of the screen, and one of them wins

The compare bar (M7) and the cookie banner (M8) were each `fixed inset-x-0 bottom-0`, written
weeks apart, each perfectly reasonable on its own. Together the banner covers the bar, and
"Compare now" cannot be clicked.

The full E2E run caught it — journey 10 timed out with Playwright reporting, precisely,
`<button>Only what is needed</button> … intercepts pointer events`. What makes it worth writing
down is **who it affected**: only a visitor who has not yet answered the cookie question. That is
every first-time visitor, and a first-time visitor is exactly who the compare feature is for. The
one person who would never hit it is the developer, whose browser answered the banner once and
never saw it again.

**Fix:** the storefront layout owns one `fixed` bottom stack and the bars are rows in it. Newest
concern closest to the edge, everything else pushed up. `pointer-events-none` on the container
with `auto` on the rows, so the empty space beside a short bar is not an invisible pane over the
page.

The rule: **`position: fixed` is a claim on a shared resource.** The second component to claim
the same edge does not know the first exists, so the edge needs an owner — one place that decides
what is pinned there and in what order.

### N9 · Next streams a second robots tag into the body under load

One mobile test in a 260-test run failed with a strict-mode violation:

```
1) <head> <meta name="robots" content="noindex, nofollow">
2) <body> <meta name="robots" content="index, follow">
```

Two robots tags on a guest order page, disagreeing. `curl` on the same URL returns exactly one,
the correct `noindex` — so this is Next 15's streaming metadata: when a page's
`generateMetadata` resolves after the head has flushed, the layout's default is emitted early
and the page's override lands in the head later. Under a loaded machine that ordering shifts.

**Not a leak.** The head carries the restrictive value, and crawlers apply the most restrictive
of conflicting robots directives. Left as it is rather than worked around in app code — the
alternative is to stop the root layout declaring a default, which would silently un-index the
whole site if any page forgot its own.

Scoping the four assertions to `head` was the first fix and it was also wrong: on the auth
pages the _only_ robots tag is in the body, so the scoped locator found nothing. Which element
ends up where depends on when the streaming boundary falls, and a test that pins the position is
as brittle as one that assumes a single tag.

They now assert the **directive**: `meta[name="robots"][content*="noindex"]` exists. That is
what the page actually promises, and it holds in both shapes.

### N10 · Two destructive suites cannot share one database, and Supabase says so first

Running `pnpm test:integration` while `pnpm test:e2e` was still going produced sixteen failures
reading `sign-in failed: Request rate limit reached` — Supabase's **own** auth limiter, not the
Postgres one in `lib/rate-limit.ts`. Both suites mint a user per test, and between them they had
burned the project's hourly sign-in quota.

The failures then cascaded: a handful of E2E tests that sign in timed out in the next run too,
because the quota does not reset when a process exits.

This is the one-project decision from docs/14 §7 showing its edge, and it is worth stating
plainly for whoever runs these next:

- **Run the suites one at a time.** They already refuse to run against an undeclared target;
  they cannot refuse to run against each other.
- A cascade of `sign-in failed` or unexplained sign-in timeouts means the quota, not the code.
  It clears on its own in minutes; re-running immediately makes it worse.

Nothing here is worth engineering around while one project serves all three roles. The second
project docs/14 §7 already recommends would fix it as a side effect.

---

## O. What building subscriptions and loyalty taught us

### O1 · The renewal engine's idempotency is one SQL statement, not a guard in the route

docs/12 M9 asks for "double invoke → one order". The obvious shape — read the due
subscriptions, build an order for each, then write the new `next_run_at` — is wrong in a way
that only shows up in production: a cron that is retried, invoked twice, or simply slow enough
to overlap itself ships the customer two boxes and charges them for both. Vercel retries a
failed cron, and the endpoint is deliberately hand-invocable for support.

So the claim and the advance are the same statement:

```sql
update subscriptions s
   set next_run_at = s.next_run_at + (s.frequency_days || ' days')::interval, …
 where s.id = p_subscription_id
   and s.next_run_at <= now()
   and (s.status = 'active' or (s.status = 'paused' and s.paused_until <= now()))
returning …
```

The second caller's `where` no longer matches, so it gets `null` and builds nothing — under
Postgres's row lock, not under a hope about timing. The order is built **after** the claim: the
failure mode that leaves is a claimed cycle whose order failed to build, which
`record_subscription_failure` catches and retries next run. The other ordering loses money.

`tests/integration/subscriptions.test.ts` proves it against SQL directly — two calls, one
result — because the property belongs to the statement, not the browser.

### O2 · `next_run_at` is a `date`, and three tests failed by exactly 16.2 hours

Three integration assertions failed by 58,320,000 ms. A number that consistent is never a race:
`subscriptions.next_run_at` is a **`date`** column, so a value written as
`now() + interval '30 days'` comes back as midnight, and any millisecond comparison is off by
however far through the day the suite happens to run.

Fixed with a `datePlusDays()` helper that compares `YYYY-MM-DD`. The general rule: **assert at
the column's resolution, not your language's.** A `date` compared as a timestamp produces a test
that passes only if it is run just after midnight.

A `date` is right here — a delivery schedule has no business carrying a time zone, and "the 15th"
means the same thing to the customer in Prishtinë and the operator wherever they are.

### O3 · Resuming a paused subscription must not ship immediately

A subscription paused for two months has a `next_run_at` two months in the past. Flipping
`status` back to `active` makes the engine treat it as due **now**, so the customer's first act
of unpausing is an unrequested delivery.

`resume_subscription` rolls the date forward by whole cycles until it is in the future, which
preserves the cadence the customer chose rather than restarting the clock. Same reasoning as
first delivery being one full cycle after checkout, not the same day: they have the product in
their hands already.

The equivalent trap is in `pause` — a paused subscription still has to be _claimable_ later,
which is why the engine's `where` clause treats `paused with paused_until <= now()` as due and
flips it back to active in the same statement rather than needing a second job to un-pause it.

### O4 · The subscription discount is a real coupon, not a branch in the pricing code

Subscription orders could have priced themselves — read the items, apply `discount_pct`, write
an order. That creates a second pricing path that will drift from checkout's the first time VAT,
shipping thresholds or stock rules change, and drift in a pricing path is a refund.

The engine instead builds a **real cart** and calls `checkout_create_order` with the `SUB-<pct>`
system coupon, so a renewal is priced by exactly the code that prices a manual order. The cost is
a dependency on a seeded row, so the engine verifies the coupon exists before it starts and
throws a named error if it does not — a missing coupon must stop the run, not silently ship
undiscounted orders to every subscriber.

`SUB-10` is `is_system`, which is what keeps it off `/offers` (§N4).

### O5 · One-click email links, with no session, without a bearer token in a URL

docs/07 §8.2 wants the notice email to let a customer skip the upcoming delivery. They are
reading it on a phone, possibly signed out, and a link that lands on a sign-in page will not be
used.

`subscription_action_tokens` follows §B5: **RLS enabled and no policy at all**, so the table is
unreachable by any client, and the only door is `subscription_apply_token(p_token)` — security
definer, single-use, expiring, and bound to one action on one subscription. A leaked link skips
one delivery once. It cannot cancel, cannot read, and cannot be replayed.

The alternative, a signed URL carrying the subscription id, is a bearer token that lives forever
in an inbox and in every mail proxy between here and the customer.

### O6 · Departure from spec: `/admin/subscriptions` is read-only

docs/06 §12 asks for pause, cancel and an editable `next_run_at` from the panel. Every one of
those already exists as a customer action, and doing them from the panel is support acting **as**
a customer — which needs an impersonation story the audit log can express. Improvising one is how
a panel ends up with staff actions indistinguishable from customer actions in the record.

Shipped: the schedule, ordered by next run rather than newest-first (an operator wants to know
what is about to happen), the status filters, and the cron health widget §12 asks for. Logged in
docs/14 §12.

The widget reads `email_log`, since there is no cron run table and adding one for a single
dashboard is a schema for a dashboard. It is a proxy — "the engine ran and had something to do" —
so the copy says "expected if nothing was due" rather than "the cron is down". A health widget
that cries wolf on a quiet week gets ignored by the second week.

### O7 · One unreproducible flake, recorded rather than papered over

The first full run of `e2e/subscriptions.spec.ts` failed on the pause control: the button sat at
`Pausing…` for the full 30 s assertion budget. Nothing in the server log, no error, and the
subscription was still `active`.

It has not recurred in **33 further executions** — alone, under `--repeat-each=4` against two
workers, and against a freshly started server to test a cold-start theory. So it is recorded here
instead of being fixed by guesswork:

- The click reached the server (`useFormStatus` only reports pending during a real submission).
- The action itself is two round trips, `getUser()` and one `update`.
- What it waits on is not the write but the **full-page RSC re-render** the action returns, and
  on this app that is a dynamic render of the entire storefront shell — §M1, still unfixed.

The budget was **not** raised to make it green. A 30 s server action is a real signal, and
docs/12 M11's performance pass owns the cause.

---

## P. What building the operations milestone taught us

### P1 · BLOCKER — the named stock error had never once been raised

`apply_stock_movement` (migration 04) applies the movement, then checks:

```sql
update inventory_levels set on_hand = on_hand + p_quantity …;
if v_on_hand < 0 then raise exception 'INSUFFICIENT_STOCK'; end if;
```

with a comment saying "the CHECK constraint would also catch this, but a named error is
actionable in the UI". It was wrong about which one fires. `on_hand >= 0` is a **column CHECK**,
evaluated by the UPDATE itself, so control never reached the `if`. Every warehouse manager who
tried to adjust stock below zero got:

```
new row for relation "inventory_levels" violates check constraint "inventory_levels_on_hand_check"
```

which the action mapped to "Something went wrong", because it is not `INSUFFICIENT_STOCK`. The
named error was unreachable code, and the message the operator needed had never been shown.

Migration 20 checks before writing, under `select … for update` so two concurrent movements
cannot both decide there is room. The CHECK constraint stays as the backstop it should always
have been.

**What found it:** an integration test asserting the _message_, not just the failure. A test for
"it errors" would have passed on this for the life of the project — and that is the general
lesson, because "it errors" is what most negative tests assert.

### P2 · A test that edits seed data can break every other suite

The first version of the M10 E2E changed the seeded Standard shipping method's price to €7.77 and
restored it at the end. An earlier assertion in that test failed, the restore never ran, and the
row stayed at €7.77.

The next integration run then failed on **an unrelated coupon test** asserting a €2 delivery fee.
Nothing was wrong with that test. Twenty minutes went into the coupon path before the diff
between "expected 200" and "received 777" resolved into "that is the number I typed into a
Playwright test".

Two rules, and the second is the general one:

1. **Create, do not edit.** The test now creates its own shipping method, which the fixture purge
   owns and which cannot corrupt anything if the test dies halfway.
2. **In-line cleanup is not cleanup.** A restore on the last line of a test runs only when every
   line above it passed — which is exactly the case where cleanup is not needed. It belongs in
   `afterAll`, which runs either way.

### P3 · The auth quota is a budget, and tests spend it

docs/13 §N10 recorded that two destructive suites cannot share one database. M10 found the
smaller version of the same problem: **one suite can exhaust the quota on its own.**

`admin-ops.test.ts` originally created a fresh actor per test — three warehouse managers, three
support agents, three admins, eight customers, twenty sign-ins — and running it alongside the
rest of the integration suite produced a dozen failures reading
`sign-in failed: Request rate limit reached`, spread across files that had not changed.

The actors are now created once per file and shared, because **a role is not state**: three tests
using the same warehouse manager cannot interfere when each acts on its own product. Customers
are still created per test wherever the test mutates them — points, erasure — since there the
identity _is_ the fixture.

Nine sign-ins instead of twenty. The rule worth carrying: create a user when the test needs a
_different_ one, not when it needs _another_ one.

### P4 · Erasure keeps the money and loses the person

docs/06 §9 says "keeps order rows, scrubs PII", and both halves matter. Deleting the orders would
corrupt every revenue figure already reported and destroy records Kosovo tax law requires be
retained; leaving the name and phone on them would make the erasure cosmetic.

`admin_anonymize_customer` therefore keeps totals, dates and status, and keeps **the city and
country** of the delivery address — a judgement call, on the grounds that a city is not
identifying at any plausible order volume and shipping-region reporting would otherwise have to
be run before every erasure.

Three things it deliberately does not do:

- **It does not touch `auth.users`.** That is outside the function's schema, and a security
  definer function reaching into GoTrue's tables is how a Supabase upgrade breaks erasure
  silently. The action scrubs the auth identity through the admin API instead — service-role
  caller #7 in docs/02 §6.
- **It does not delete the auth user.** Eleven tables reference `profiles(id)` without
  `on delete` behaviour (§M9); deletion fails at the foreign key and leaves the scrub half-done.
  The email is replaced and the password randomised instead.
- **It refuses staff.** Anonymising a colleague would orphan every `audit_logs` row they wrote —
  the trail would still name an actor id nobody could resolve to a person, which is not an audit
  log.

### P5 · Deactivating a colleague has to happen in two places

The team screen's "Deactivate" first only stamped `profiles.deleted_at`, and the comment claimed
that stopped them signing in. It did not: `getProfile` had never filtered on `deleted_at`, so a
deactivated staff member kept working normally.

Writing the comment is what caught it — the claim was checkable, and it was false.

The fix is both layers, because either alone is wrong:

- `getProfile` now treats a soft-deleted profile as absent, which revokes the session they are
  holding **right now**. Every guard in the app already asks that function, so one line closes
  all of them.
- A **GoTrue ban** stops them getting a new session. Without it, `deleted_at` alone would leave
  someone able to sign in successfully and then bounce off every page — which reads as a broken
  app rather than a revoked account.

The same filter is what makes GDPR erasure take effect immediately, since erasure stamps the same
column.

### P6 · A jsonb column typed as `string` is a runtime crash, not a wrong label

`v_admin_inventory.variant_name` is `product_variants.name`, which is jsonb. The row interface
declared it `string`, TypeScript was satisfied, and React 19 threw:

```
Objects are not valid as a React child (found: object with keys {en, sq})
```

taking `/admin/inventory` down to the global error page. In production the message is redacted to
`DYNAMIC_SERVER_USAGE`-style opacity, so the diagnosis took a dev server.

Two things worth keeping:

1. **A hand-written row interface is an assertion, not a check.** `.select()` returns `any`-ish
   shapes that the generated DB types do not narrow for views, so every localized column has to
   go through `pickLocaleFrom`. The neighbouring `product_name` did; this one did not, and
   nothing in the type system noticed.
2. **Run the failing page against `pnpm dev` before theorising.** The production error told us
   nothing; the dev server named the component and the keys in one line.

### P7 · The budget was a preference until a test made it a constraint

`buildRoutine` trimmed the routine to fit the customer's monthly budget, then topped it back up
to the three-product minimum from the same pool — undoing the trim. A €45 budget produced a €60
routine.

The unit test caught it on the first run, which is the argument for the finder's scoring being a
pure function: this is a ranking bug, and asserting a ranking through a browser means asserting
the order of five cards on a page.

The rule the fix encodes: **the budget is a constraint, like the diet, not a preference like the
rating.** Padding past it hands back a routine the customer has already said they cannot afford,
and it makes the budget field look like it did nothing. Two products under budget is the honest
answer.

### P8 · Departures from spec in the operations screens

Four, each for a stated reason:

| docs/06 asks for                       | Shipped instead                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §8 "Receive stock dialog (variant, …)" | Per-row receive and adjust panels. The picker version reads better in a spec and is worse in a warehouse: the operator has already found the row, and a dropdown of four hundred SKUs is how stock gets received against the wrong variant |
| §13 "side-by-side preview" on articles | Plain markdown fields. A live preview needs the sanitising pipeline (§N3) running in the browser — shipping rehype to the client for a screen only content managers open                                                                   |
| §15 "Payments … credentials status"    | Presence only, computed on the server, never an input. A key pasted into a database row is a key in a backup, in an export, and in the audit log                                                                                           |
| §15 "Tax … prices include VAT"         | Stated, not offered. `computeTotals` derives tax _out of_ a VAT-inclusive price (docs/07 §2); flipping it would not change a calculation, it would change what every price in the shop means                                               |

---

## Q. What the hardening pass taught us

### Q1 · The storefront is static again, and the build output still cannot be trusted to say so

§M1 recorded that `Navbar` read the cart cookie, that a request-scoped API in a layout makes
every page beneath it dynamic, and that the build output printed `● (SSG)` throughout while
`.next/server/app` held **seven** HTML files — all of them auth pages.

Fixed by moving the count into `CartBadge`, a client component that fetches after mount. The
header now reads nothing request-scoped at all.

|                           | before  | after                                 |
| ------------------------- | ------- | ------------------------------------- |
| Prerendered `.html` files | 7       | **127**                               |
| `/en` (home)              | dynamic | `x-nextjs-cache: HIT`, `s-maxage=300` |
| `/en/product/…` (PDP)     | dynamic | `x-nextjs-cache: HIT`, `s-maxage=300` |

**Not everything, and deliberately so.** `/shop`, `/shop/[category]`, `/goals/[slug]` and
`/knowledge` all read `searchParams`, which is dynamic by definition — they have filters, and a
filtered page cannot be a file. That is the correct trade, not an oversight, and
`e2e/rendering.spec.ts` lists exactly which pages must be static so the distinction is written
down rather than remembered.

The guard is the interesting part. The regression is invisible in the build output — that is what
let it survive from M4 to M11 — so the test asserts the **response header**: `no-store` present
is the fingerprint of a dynamic render. One `cookies()` call in a layout component and eight
tests go red at once.

Two things the fix needed that the original note did not anticipate:

- **The badge has to hear about changes.** `revalidatePath('/', 'layout')` re-renders the server
  tree, but the count no longer comes from that render. A `shneta:cart-changed` DOM event covers
  same-page mutations; the pathname covers navigation. A context provider would have meant every
  future add-to-cart remembering to call a setter, and the one that forgets shows a stale number
  for the rest of the session.
- **The label must not lie while loading.** Rendering "0 items" and correcting it a moment later
  tells a screen-reader user something false. The count is absent from the label until it arrives.

### Q2 · A rate limit nobody calls is a rate limit that does not exist

`RATE_LIMITS.finderSubmit` was declared when `quiz_submissions` was designed in M1 and applied to
nothing. M10 then shipped the finder — an **unauthenticated write endpoint**, because the table
accepts a null `user_id` on purpose so guest answers are recorded — with no limit on it at all.

Found by reading the constant table against the call sites during the M11 security pass, not by a
test. Worth stating plainly: the declaration looked like coverage. Anyone auditing `RATE_LIMITS`
would have concluded the finder was protected.

Both write paths are limited now. The one in `submitFinder` had to move **outside** its `try`:
`redirect()` works by throwing, so a catch around it swallows the redirect and logs it as a
failure.

### Q3 · The strict CSP cannot be enforced, and it took an experiment to prove it

docs/10 §5 asks for report-only in week one, then enforcement. Flipping the switch would have
broken the entire site.

Next.js streams its RSC payload and hydration data through inline `<script>` tags, so
`script-src 'self'` blocks them. Measured rather than assumed: with the strict policy enforced,
each of ten sampled pages logged a run of

```
Executing inline script violates the following Content Security Policy directive
'script-src 'self''. … The action has been blocked.
```

and no page became interactive. The page renders — server HTML is fine — and nothing works.

Both escapes cost more than they save:

- A **nonce** must be generated per request in middleware, which makes every page dynamic and
  undoes §Q1. Trading the Full Route Cache for a directive is the wrong side of that bargain.
- **Hashes** cannot work: the inline payload differs per page and per build.

So the policy ships in two versions. The **enforced** one allows inline script and keeps
everything else strict — it still blocks third-party script origins, `eval`, plugin content,
base-tag injection, framing and cross-origin form posts, which is most of what an injected
`<script src>` or a clickjacking attempt needs. The **strict** one ships alongside as
report-only, so violations stay visible and the day Next supports nonces without forcing dynamic
rendering, the reports will already be clean.

`CSP_ENFORCE` promotes the first from report-only to enforcing, so launch week is a redeploy
rather than a code change and the rollback is unsetting a variable.

### Q4 · Widening the axe pass found a contrast bug that had shipped in M5

The axe sweep covered home, the shop, a PDP, cart, checkout, auth, account orders and the admin
**dashboard**. M11 extended it to the M10 surface, and `/admin/inventory` returned **58
violations** on the first run.

The cause: every admin list puts a count inside its filter tabs —

```tsx
<span className="font-ui text-xs text-ink-500">{count}</span>
```

— and the selected tab is filled `forest-100`. `ink-500` on `forest-100` is **4.00:1** against a
4.5 floor. Seven admin lists and the public Knowledge page carried it. It shipped in M5 and
survived six milestones because **the one admin page axe covered has no tabs**.

`ink-600` is 5.54:1, and `tests/unit/contrast.test.ts` now pins both directions — the failing
pair and the passing one — the way §N7's `forest-600` pairing is pinned.

The lesson is about coverage shape rather than colour: a sample of pages tests the pages in the
sample. The tab pattern was on eight screens and none of them was the one being checked.

### Q5 · Three advisories, and none of them ours

`pnpm audit` reported 1 moderate and 3 high, all transitive: `postcss` (three) via Next's own
dependency, and `sharp` (one, a libvips CVE bundle) via image optimisation. docs/09 §5 sets the
gate at **no criticals**, which was already met — but shipping four known-high advisories at
launch because the gate is written loosely is not a defensible reading of it.

Both resolve with `pnpm.overrides` to already-published patches, and the build, the type check
and the full suite pass unchanged. `pnpm audit` is now clean at `--audit-level moderate`.

The trade worth naming: an override pins a transitive dependency ahead of what the parent
declares, so a future Next release could conflict. That is a visible failure at install time,
which is the right place for it — unlike an unpatched advisory, which is invisible until it is
not.

### Q6 · Two more things the widened axe pass found, both about hiding rather than colour

**Scrollable regions were unreachable by keyboard.** Every admin table is `overflow-x-auto` with
a `min-w` inside, so at 390 px each becomes a horizontally scrolling region — pannable with a
mouse or a thumb, and impossible with a keyboard until you tab into a link three columns across.
`/admin/movements` alone returned **52 instances**. Nine components now carry
`role="region"` + `tabIndex={0}` + a label, which is the pattern the ARIA authoring practices
prescribe.

That fix then failed lint: `jsx-a11y/no-noninteractive-tabindex` allows `tabindex` only on
`tabpanel` by default. Two accessibility tools disagreeing, and axe is the one measuring real
browser behaviour — so `region` joined the allowlist in `eslint.config.mjs` with the reasoning
written next to it, rather than nine files each carrying a disable comment.

**`opacity-70` on a container is a contrast decision.** The team screen faded a deactivated
member's row, the subscription card faded a cancelled subscription, the FAQ list faded a hidden
question. Fading a container recolours every descendant: white-on-`ink-600` became
`#fefdfc` on `#878d88` (**3.33:1**) and `ink-500` became `#969c97` on white (**2.75:1**).

This is §N7's rule — _an alpha on a text colour is a new colour_ — one level up. The tokens were
all correct; the wrapper undid them. Replaced with an explicit `bg-cream`, which reads as "off"
without touching a single foreground value, and in every case the state was already labelled in
words too.

### Q7 · What M11 could not do, and why it is not a gap in the code

docs/12 M11 asks for "every checklist item ticked with evidence". Six items cannot be ticked from
here, and none of them is an engineering task:

| Item                         | Blocked on                                                            |
| ---------------------------- | --------------------------------------------------------------------- |
| Domain, DNS, HTTPS           | Owner — no domain is registered                                       |
| Resend verified, test sends  | Owner — fourteen templates are inert until it is (docs/14 §6)         |
| Sentry alerts firing         | Owner — the SDK is wired and inert without a DSN                      |
| Uptime monitor               | Owner — `/api/health` exists and answers                              |
| Restore drill                | Owner — the runbook is written; the drill needs a scratch project     |
| Real test order with courier | Owner — needs a courier and a real address                            |
| Lighthouse ≥ 95 on prod      | Needs prod. Measurable now only against a laptop, which proves little |

Two more are blocked on content rather than infrastructure: the legal pages are still
`[LEGAL: review]` placeholders, and the shop still sells 24 demo fixtures.

The honest summary is that **the code is ready and the business is not**, and that distinction is
worth keeping visible rather than blurring into a percentage.

---

## E. Stack decisions taken at M0

| Item          | Spec                  | Built as            | Why                                                                                               |
| ------------- | --------------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| Next.js       | 15                    | **15.5.x**          | Held to spec — now **settled by measurement**, not deferred. See §E2 below                        |
| TypeScript    | "strict"              | **5.9.x**           | TS 7 (native port) is current but the ESLint type-aware and `next` plugin ecosystem still lags it |
| ESLint        | —                     | **9.x flat config** | `eslint-config-next` 15 targets 8/9; ESLint 10 is not yet supported by it                         |
| Zod           | unpinned              | **4.x**             | Stable, and `@hookform/resolvers` 5 targets it. Schemas are single-sourced per `02 §7` regardless |
| Framer Motion | `framer-motion`       | **`motion` 12.x**   | Same library, current package name. `framer-motion` is the legacy alias                           |
| Rate limiter  | Postgres _or_ Upstash | **Postgres**        | `02 §9` says choose Postgres unless Upstash keys are provided. None are                           |

### E2 · Next 16 — evaluated on a branch, rejected for now

The earlier note deferred this "to a decision point before M3". It was instead settled the
only way worth settling it: by doing the upgrade on `chore/next-16`, running the full gate,
and measuring. The branch reached green — this is not a "it didn't work" outcome.

**What the upgrade required** (both small, both genuine improvements):

1. `revalidateTag(tag)` → `revalidateTag(tag, profile)`. The cache profile is now a required
   second argument; `'max'` is the correct value for an admin purge, because a profile
   shorter than an entry's real lifetime can leave it serving stale content.
2. `eslint-config-next` 16 ships native flat configs on subpath exports. The `FlatCompat`
   eslintrc bridge cannot load them (it throws `Converting circular structure to JSON` on
   the react plugin); import `eslint-config-next/core-web-vitals` and `/typescript` directly
   and drop `@eslint/eslintrc`.

**What decided it — client JS.** Measured identically on both (scripts referenced by the
prerendered `/` document, gzipped from disk — `pnpm measure:bundle`):

| Setup                             | First-load JS | vs Next 15 |
| --------------------------------- | ------------- | ---------- |
| **Next 15 + webpack**             | **167 kB**    | —          |
| Next 16 + webpack                 | 190 kB        | +13%       |
| Next 16 + Turbopack (the default) | 214 kB        | **+28%**   |

`09 §3` sets a 170 kB budget and `01 §4` makes LCP < 2.0 s p75 on mobile a hard NFR, for a
market where mid-range Android on mobile data is the norm. Spending 28% more JS _before the
storefront exists_ — no product cards, no filters, no cart drawer, no checkout form — takes
headroom that M3 and M4 need.

Turbopack also stops emitting a per-route bundle manifest and Next 16 drops the size columns
from build output entirely, so we would lose per-route visibility exactly at the milestones
where bundles grow fastest.

**Decision: stay on Next 15.5.x.** Nothing in M2–M8 needs a Next 16 feature, and 15.5 is
supported.

**Revisit after M4**, when the real bundle picture is known — or sooner if Next 16 narrows
the gap or Next 15 nears end of support. The migration is now de-risked rather than unknown:
the two required changes are written down above, so it is a short job whenever it is taken.

**Kept from the branch** (improvements independent of the version): the
`useSyncExternalStore` rewrite of `NewsletterStatus` — Next 16's `react-hooks` v7 flagged
`set-state-in-effect`, a real cascading-render bug our current ruleset misses; the
dual-mode `check:bundle`, which already understands Turbopack builds; and
`scripts/measure-bundle.ts`, the bundler-agnostic measurement that made this comparison
possible.

### E1 · Framer Motion is not mounted globally

`04 §8` makes Framer Motion the motion system, which reads naturally as "wrap the app in
`MotionConfig`". Measured, that costs the whole storefront ~46 kB of shared client JS: the
M0 shell alone came in at **169 kB First Load JS against the 170 kB budget** in `09 §3`,
before a single product card existed.

Two changes bring it to **120 kB**, leaving ~50 kB of headroom for the actual catalog UI:

1. **The Vitality Ring is a Server Component with a CSS animation.** It appears above the
   fold on Home, PLP and PDP, so it must not be the reason Framer lands on the critical
   path. `@keyframes vitality-draw` produces the identical 400 ms ease-out-quint draw-in,
   and the global `prefers-reduced-motion` rule neutralises it without JavaScript.
2. **No global `MotionConfig`.** Framer is imported by the individual widgets that need
   real gesture/layout animation — cart drawer, mega menu — which are client-only and
   code-split. `reducedMotion="user"` is set on those local providers.

`04 §8` stands as the motion vocabulary; `lib/motion.ts` holds the variants unchanged. What
changes is where the library is mounted.

---

## F. Implementation traps worth recording

1. **next-intl + a non-localized `/admin`.** `localePrefix: 'as-needed'` makes the intl middleware
   claim every path. `/admin`, `/api` and static assets must be excluded from its matcher, and the
   Supabase session refresh has to run on _both_ branches. Composed explicitly in `src/middleware.ts`
   rather than by chaining the two middlewares.
2. **Env validation must not leak.** A single `lib/env.ts` that touches `SUPABASE_SERVICE_ROLE_KEY`
   will pull it into any client bundle that imports the module. Split into
   `env.client.ts` (`NEXT_PUBLIC_*` only) and `env.server.ts` (`import 'server-only'`).
3. **CSP.** `10 §5` specifies `'self'`-based CSP. Next.js needs `'unsafe-inline'` for styles, or a
   per-request nonce, which forces dynamic rendering and defeats the ISR strategy in `02 §5`.
   Ship `style-src 'self' 'unsafe-inline'` and keep `script-src` nonce-free but strict; revisit at M11.
