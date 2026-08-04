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
Single-token signal rings are not used anywhere.

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
`'brand-%'`, emails `LIKE '%@biocode.test'`, orphaned `LOY-` coupons), so it cannot touch real
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
  tree, but the count no longer comes from that render. A `biocode:cart-changed` DOM event covers
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

## R. What rebranding to BIOCODE taught us

### R1 · A rebrand is not an invitation to redesign

The brief said: new name, new tagline, "premium, modern nutrition". It did **not** say new
palette. Reading "rebrand" as "redesign the visual system" produced a deep blue-graphite ramp and
an electric-aqua accent, a bar-sequence logo, and 601 token replacements — all of it discarded
when the actual BioCode brand kit arrived and turned out to keep the existing identity: the
**Vitality Ring**, forest, lime, cream. The rebrand was the name and the wordmark.

The work was not wasted in one respect and was entirely wasted in the other, and the split is the
lesson:

- **Kept:** the method. Every candidate colour was checked against `tests/unit/contrast.test.ts`
  before a line of CSS changed — see R2. That is how the palette should always be changed.
- **Lost:** a day of renaming tokens, rewriting two design documents and re-recording a palette
  that no longer exists.

**Ask for the asset kit before designing one.** A brand with a name and a tagline usually has a
logo too, and the cost of asking is one question against a full reversal. Where a client has
supplied any identity at all, the default is to implement it, not to improve it.

### R2 · The palette is designed against the test suite, not checked by it afterwards

This survives the reversal, because it is how the _restored_ palette is guaranteed too.

`tests/unit/contrast.test.ts` reads the real token values out of `globals.css` and makes
thirty-two assertions, three of them deliberately negative. That is a **specification**, not a
safety net. Every candidate value went through those assertions in a scratch script first, and
two of the first draft's values failed and were solved rather than nudged:

- `ink-500` under the 4.5 floor on the page background. The constraint is a **band**, not a
  minimum: it must clear AA on the background _and_ miss it on both tints, because that gap is
  what encodes "secondary text on a tint is `ink-600`" (§Q4).
- the graphics-only mid had to land inside **[3, 4.5)**: above SC 1.4.11 so icons are visible,
  below AA so nobody sets text in it.

Designing to a numeric contract is faster than designing and then fixing. The discarded draft
would otherwise have shipped two AA regressions, both found later by axe on whichever page
happened to be sampled.

The same suite is what made the reversal safe: restoring the original values and re-running it
returned 32/32 immediately, with no manual re-checking of any pair.

### R3 · A fixture script that creates by id will never fix an address

`seed-users.ts` creates the seven staff accounts with **fixed UUIDs**, so `seed.sql` can
reference them. On a re-run the create fails with "already exists", the script moves on, and the
account keeps whatever email it had.

Which meant that after the rebrand, `pnpm seed:users` would have gone on reporting
`admin@biocode.dev` — cheerfully, indefinitely — while the account was still
`admin@shneta.dev`. The script would have been lying, and nothing would have caught it, because
its own output is the only thing anyone reads.

It now reconciles the address as well as the password, and reports `email updated` when it does.
The six live accounts were migrated in the same pass.

The general shape: **an idempotent script keyed on an immutable id must reconcile every mutable
field it claims to own**, or it silently drifts from its own source of truth.

### R4 · What a rebrand touches that is not visible

The obvious surfaces — wordmark, palette, copy, metadata — were the easy half. The rest:

| Surface                 | Why it matters                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie names            | `shneta_cart` → `biocode_cart`. **Every existing cart is orphaned by this.** Free now, because there are no customers; after launch it would need a read-both-write-new migration                           |
| The cart-changed event  | `shneta:cart-changed` → `biocode:cart-changed` (§Q1's badge listens for it)                                                                                                                                 |
| Fixture email domains   | `%@shneta.test` is what `purgeFixtures` matches on. Renaming the convention without renaming the purge patterns would have left every future test row permanently un-purgeable                              |
| `settings.store`        | A live database row, not code. The storefront reads its name, contact and socials from it                                                                                                                   |
| The manifest theme      | `theme_color` was the old page background; it is now `forest-900`, so the browser chrome matches the brand rather than the paper                                                                            |
| Seeded content **rows** | The seed files were renamed by the sweep; the live database was not. `seeds/*.sql` only ever run on `supabase db reset`, which nobody will run against the one project that is also production (docs/14 §7) |

The fixture-domain one is the quiet trap. The rename and the purge patterns are in different
files, and the failure is invisible — tests keep passing, rows keep accumulating, and nobody
notices until the database is full of them.

The seeded-rows one was the loud trap, and it took **three steps**, not one. The E2E navigates to
`/en/knowledge/biocode-tani-ne-kosove`, and getting that to pass needed:

1. the seed file renamed (the sweep did this),
2. the live row migrated — a published `slug` change, which CLAUDE.md §10 forbids and which is
   defensible here only because this is demo content with no traffic and no inbound links,
3. **a rebuild.** `generateStaticParams` bakes the slug list at build time, so until the app was
   rebuilt the new URL was not prerendered and the old one still was.

Step 3 is the one that is easy to miss, because steps 1 and 2 make the page work on a cold server
and it looks finished. A stale build serves the old slug from the Full Route Cache quite happily —
which, after §Q1 made the storefront static again, is now true of far more pages than it used to
be. **Data migrations that change a slug are deploys, not database work.**

### R5 · The logo and the interface share one device, and the code must not redraw it

The BioCode mark **is** the signature element: docs/04 §2 lists the logo backdrop as one of the
four permitted uses of the Vitality Ring, and the kit confirms it — the same ring is the loading
spinner and the PDP rating arc, so "the logo and the interface share one signature".

That makes one thing worth stating. `BrandMark` carries the two arc paths **copied verbatim**
from `public/brand/biocode-mark.svg`: same 100-unit radius, same 26-unit stroke, same sweep
angles. It would have been easy — and it was in fact done, briefly — to approximate the ring with
two `<circle>` elements and a `stroke-dasharray`. That version renders about right and is
subtly not the logo, in the one place every visitor sees it, and nobody notices until it is
placed next to the exported file.

The distinction the two components encode:

- `brand-mark.tsx` — the **logo**. Fixed geometry, never animated (docs/04 §2), never recoloured.
- `vitality-ring.tsx` — the **instrument**. Its gap moves because it means something: a rating,
  a routine's completeness. Parameterised, animated once on mount.

`public/brand/USAGE.md` states which file each one comes from, so the next person changing either
knows the other exists.

---

## S. What configuring email actually switched on

### S1 · A key that had been safe to be missing became dangerous the moment it arrived

For eleven milestones `sendEmail` recorded `skipped_no_provider` and returned cleanly, so the
E2E suite could place forty orders a run and nothing left the building. The `@biocode.test`
fixture convention was chosen for isolation, not for safety — nobody had to think about where
those messages went, because they went nowhere.

Adding `RESEND_API_KEY` changed that in one step, and not in the obvious direction. `.test` is
reserved by RFC 6761 and can never be delegated, so every one of those addresses is a
**guaranteed hard bounce**. A full suite run would have posted dozens of them at a sending
domain that was verified an hour earlier and has no reputation yet — and bounce rate is the
single fastest way to lose one. Providers suspend accounts over it. The damage does not undo
itself when you stop: `shtrejt.com` would have reached launch already distrusted, with real
order confirmations landing in spam.

Nothing failed to catch this, because nothing was looking. The suites were green before the key
and would have been green after it — the bounces happen at the provider, days later, and
surface as a deliverability problem nobody connects to a test run.

**The fix is a property of the address, not a flag.** `EMAIL_DISABLED=true` in the test
environment is the obvious answer and the worse one: it has to be remembered, it is absent from
a fresh clone, and it fails open. `isUndeliverableRecipient` refuses the reserved TLDs outright
(`.test`, `.invalid`, `.example`, `.localhost`, plus the RFC 2606 `example.*` domains), checked
**before** the provider lookup so it holds whether or not a key is configured.

It records `skipped_test_recipient` rather than dropping the message, because the log is how
three E2E tests assert an email was attempted. Those assertions check that a **row exists**,
never its status — which is why this change did not break them, and is the right way to write
them: whether a provider is configured is not the test's business.

`.local` is deliberately allowed. It is mDNS, not an RFC 2606 reservation, and a corporate
intranet can legitimately deliver to it — blocking it would be a guess dressed as a standard.

### S2 · The key was in the file under a name nothing reads

It arrived as `resend_api`. `serverEnv` reads `RESEND_API_KEY`, and both it and `EMAIL_FROM`
are `.optional()` in the schema — correctly, since the app must run without them — so nothing
complained. The app started, the health check passed, and every email silently recorded
`skipped_no_provider` exactly as it had the day before.

An optional variable is a variable whose absence produces no error anywhere, which is the
behaviour you want and also means **the only proof it is wired is a send that succeeds**.
Hence `pnpm email:test`: it reads the same two variables, fails loudly and specifically when
either is missing, and tells you what to add.

---

## T. What building the BioHack Protocol Generator taught us

### T1 · Postgres block comments nest, and a migration is one statement to `db push`

Migration 22 refused to apply, and the error named "statement 0" — the whole file. Three
theories, in order: odd apostrophes in the prose comments (made them even; still failed),
semicolons inside string literals (a real latent hazard, fixed, still failed), and finally the
actual cause.

A comment contained the path `supabase/seeds/*`. **Postgres block comments nest** — unlike C, unlike
JavaScript, unlike almost everything else a person writing SQL has in their fingers. That `/*`
opened a second comment level that nothing ever closed, so the closing `*/` merely returned to
depth one and every statement after it was commentary. Seven `/*` against six `*/`.

Two lessons worth more than the fix. The first is diagnostic: the error pointed at the file, not
a statement, and that is the signal — a syntax error inside one statement names that statement.
Bisecting with a minimal probe migration proved the file was at fault in about a minute after an
hour of reading SQL. (Clearing the probe afterwards needs
`supabase migration repair --status reverted <version>`; a deleted file whose row survives in
`supabase_migrations` blocks every later push.)

The second is that `check:sql` did not catch it, and now the balance of `/*` and `*/` is one more
thing it counts.

### T2 · A `left join` in a seed is a CHECK violation waiting for a missing row

The blocks insert joined 51 rows to `ingredients` on slug. `iron` exists as an ingredient with no
product behind it in some environments and not others — and a `left join` that misses yields a row
with a null `ingredient_id` and no habit text, which is exactly what
`protocol_block_is_ingredient_or_habit` forbids. One absent ingredient failed the whole migration.

`where b.ingredient_slug is null or i.id is not null` makes a missing ingredient cost one block
instead of the config. A seed that joins to reference data should always state what it does when
the reference is not there, because "it is always there" is a claim about every environment the
migration will ever run in.

### T3 · Forty-two tests passing first time is not evidence; mutation is

The engine's unit suite went green on the first run, which is not what usually happens and is
therefore worth distrusting. Three deliberate mutations later, two failed tests as expected and
one — deleting the final tiebreak in `bestFirst` — failed **nothing**.

The determinism test was proving that the pipeline is deterministic without proving that line
contributed to it: the ordering it asserted came from an earlier sort plus V8's stable sort, so
the tiebreak was dead code as far as the suite was concerned. The case that fixes it is
deliberately awkward — one item scoring 100 from a single heavy block, another scoring 100 from
two light ones, so the pre-sort inserts them in the wrong order and only the final comparison can
put them right.

A test suite that has never been mutated is a suite whose coverage is a guess.

### T4 · An `sr-only` input is invisible to a person *and* to everything else

The goal tiles hid a 1×1 `sr-only` checkbox behind a decorative checkmark span. Clicking the
label worked, keyboard focus worked, a screen reader read it correctly — by every test a human
would run, it was fine. Playwright's `.check()` could not tick it: the click landed on the
decoration.

The instinct is to fix the test. The right fix was the markup: the input is now transparent and
stretched over the whole tile, so the hit area *is* the control. Same appearance, and now the
thing that receives the click is the thing that holds the state. When automation cannot drive a
control that a person can, the control is usually wrong — automation is a second implementation
of "use this widget", and disagreement between the two is a finding.

### T5 · A translucent sticky bar cannot promise contrast

`bg-surface/85` with a backdrop blur looks better than an opaque bar over almost every part of a
page. axe failed it, and correctly: when the bar comes to rest over the dark footer, the effective
background is the footer, and `ink-500` on it is well below AA.

There is no clever fix. A translucent element's contrast is a property of whatever is behind it,
which it does not control and cannot know. Either the page guarantees what is underneath, or the
element is opaque. Two other violations in the same pass were ordinary — `ink-500` on the lime
habit tile, and a `<ul>` holding `<span>` chips directly — but this one is a rule: **translucency
and a contrast guarantee are mutually exclusive.**

### T6 · The customer's result page must not be a live query

The first design regenerated the protocol on every view from the answers in the URL. It is
tempting — the engine is a millisecond, the code is smaller, and nothing needs storing.

It is also wrong twice over. A customer who reopens their link after the catalogue changed would
see a different protocol with no explanation, and "compliance can point at the approved version
that produced it" (docs/15 §8) would be false the moment a weight moved. So the row is written at
generation and the page renders the **snapshot**. `inputs` and `config_version` are stored beside
it so the same result can be reproduced deliberately, which is a different thing from reproducing
it by accident.

The corollary shaped the whole page: "Ndërro" and "Hiq" are client state and never write. Two
people opening one share link must see the same protocol.

### T7 · The guest round trip solved itself once the protocol had an address

docs/15 §6 asks for guest state to survive signing in, and suggests encoding the inputs in the
redirect and regenerating. Once the protocol is a stored row at its own URL, there is nothing to
encode: the guest signs in, returns to the same URL, and "Ruaje" claims the unowned row for their
account. `update … where user_id is null` is the whole implementation, and it is also what stops
whoever holds the link from stealing a protocol that already has an owner.

### T8 · Approving a version is three statements in one order, and an index enforces it

`one_approved_protocol_config` is a partial unique index on `status` where `status = 'approved'`.
Approving therefore cannot be a single update — the new row collides with the old one — so
`approveConfig` archives the live version first, approves the candidate second, and purges
`biohack-config` third.

Writing it in that order is not defensive style; it is the only order that works, and the
integration test asserts the constraint rather than the action. An action that happens to work
would keep passing if the index were dropped. The test would not.

The third statement matters as much as the first two: `getApprovedConfig` is an `unstable_cache`
entry with no TTL (docs/13 §K1), so without `revalidateTag` an approved version reaches nobody
until the next deploy — a failure that looks exactly like the approval not having happened.

### T9 · The Finder's supersession was two changes that are wrong to ship apart

Redirect without the sitemap edit leaves a listed URL that 308s. Sitemap edit without the redirect
breaks every link in the wild. One test asserts both.

Removing it also exposed a contradiction that had been live since M10: `/finder` was **in the
sitemap and disallowed in `robots.txt`**. Nobody noticed because each file was correct on its own
terms — the sitemap entry was added by a test asserting the page was listed, the disallow by the
docs/08 §4 rule about query-driven surfaces. A page can be advertised or forbidden, not both.

And a feature that stores personal data leaves an obligation behind it: `generated_protocols` now
appears in the GDPR export next to `quiz_submissions`, because `inputs` holds the medication and
life-stage answers.

### T10 · Two compliance lists, one of them enforced, and the difference is the reviewer

`CLAIMS_REMINDER` in the catalogue is advisory — shown beside a product description, never
enforced, because a blocklist is defeated by a synonym and rejects "does not treat".

The BioHack PSE copy gets a **hard block**, and the reason is not that the rule is stricter. It is
that the reviewer does not exist. A product description is written once and read by a compliance
manager before it ships. A protocol block's copy is recombined with fifteen others and generated
at a customer; nobody ever reads the page it appears on. The same list is imported by the
integration test that checks the shipped config, so the editor and the test can never disagree
about what is allowed.

### T11 · What the analytics card does not show, and why that is written on it

docs/15 §4 asks for add-all conversion and most-swapped items. Neither is displayed, because
neither is recorded: swaps are client state by design (§T6), and a cart carries no reference to
the protocol that filled it. Both need an event to exist first.

The card says so in plain text rather than omitting the sections silently. A missing metric that
is explained is a backlog item; a missing metric that is merely absent reads as a metric of zero.

### T12 · Two things pinned to the same edge is always the same bug

The result page's action bar fixed itself at `z-30`. On mobile the cookie banner — `z-40`, in the
layout's bottom stack — sat on top of it and swallowed every click on "Shto gjithçka në shportë".

This is **docs/13 §N8 verbatim**: the compare bar and the banner did exactly this in M10, and the
fix then was the shared bottom stack in the storefront layout, with a comment explaining why. The
stack existed the whole time and the new bar simply did not join it. A pattern that has to be
remembered is a pattern that will be forgotten; this one now has an explicit `#bottom-stack-slot`
that a page portals into, which is a thing you can find by searching for the problem.

The cost of joining it is that the bar is no longer server-rendered. Acceptable on this page and
nowhere else: swap, remove and the running total are all client state, so there is no meaningful
no-JavaScript rendering to protect.

**Two E2E lessons came with it.** The first: content can sit under the bottom stack while consent
is unanswered — a general property of the layout, not of this feature, and the reason every
context in `biohack.spec.ts` starts with the consent cookie already set. The second is why it is a
*cookie* and not a click: the banner reads its cookie **after mount**, deliberately, to avoid a
hydration flash. A dismiss-if-visible helper therefore raced it and lost — not yet rendered when
the check ran, covering the button by the time the test clicked. Seeding the state beats
dismissing the symptom.

### T13 · A fixture unique per file is not unique per run

`e2e/operations.spec.ts` created a shipping method called `E2E Test Courier` and deleted it in
`afterAll`. Correct for one run of one file — and `desktop` and `mobile` run every file
concurrently against one database. The two raced: the second create collided on the name, and
whichever `afterAll` fired first deleted the other's row mid-assertion.

It passed for a whole milestone because the schedule happened to keep them apart, and started
failing the day the suite grew by 34 tests. Nothing about the change caused it; the change only
moved the timing. The name now carries the project, and cleanup matches on the prefix so a run
that dies before `afterAll` is swept by the next one.

Worth generalising: **a fixture name is only unique across everything that runs at once**, and in
this suite that includes a second browser project running the same file.

### T14 · The default row on an admin screen belongs to whoever ran first

The matrix tab defaults to the first goal in `sort_order`. The admin taxonomy spec creates goals
of its own, so during a full run the first tile was sometimes another test's fixture — `Emri
Provëno`, with no blocks — and the assertion about the editor became an assertion about test
ordering.

Pinning `?goal=gjumi` fixed the test, and the finding is the general one: an E2E that depends on
"the first item" depends on every other spec that can create items.

---

## U. What loading the launch copy taught us

### U1 · Editing a seed file does not re-seed anything

`supabase db push --include-seed` tracks a hash per seed file. When the hash changes it prints
`Updating seed hash to …`, records it, and **skips execution**. Only a file it has never seen
produces `Seeding data from …` and actually runs.

The consequence is quiet and one-directional: an edit to `seed.sql` reaches every fresh
`db reset` and never reaches the environment that is already live. Found by correcting the store
contact block, pushing, and watching the live row keep saying `info@biocode.com` — twice, because
the first attempt was to move the statement into an existing seed file, which had the same hash
problem for the same reason.

Two things follow. Content that must land on a seeded database goes in a **new numbered file**;
seed corrections behave like migrations. And the two mechanisms serve different jobs: `seed.sql`
is what a fresh environment gets, `seeds/NN-*.sql` is how an existing one is changed.

### U2 · A guard that reads config protects against the wrong failure

`assertPurgeable` asks whether `SUPABASE_TEST_PROJECT` names the target. That catches a
misconfigured environment, and it is the earlier and cheaper check — it throws during import,
before a fixture exists.

What it cannot catch is the failure this project is actually exposed to. One Supabase project
serves dev, test and production (§7), and the entire protection on launch day is a human
remembering to delete an environment variable at the moment they are busiest. A config guard
reads the intent; it has no opinion about whether the intent is still true.

So there is now a second guard that asks the database: `assertNoRealOrders` refuses any target
holding an order whose email is neither a `@biocode.test` fixture nor an `@deleted.invalid`
anonymisation. Both are residue this suite created; anything else was placed by a person.

Three details that decide whether it is useful or ends up switched off:

- **It fails closed on a query error.** A guard that cannot see the data has verified nothing,
  and "I could not look" must not read as "it is fine".
- **The `@deleted.invalid` exclusion is load-bearing.** Fifteen anonymised orders were already
  sitting in the database from the GDPR-erasure tests. Without the exclusion the guard would have
  fired on day one, and a guard that always fires is a guard someone deletes.
- **Its own test can brick the suite,** because proving it works means inserting an order that
  looks real. If that test dies between the insert and its `finally`, the leftover row refuses
  every later run. Hence the `SH-9999-` order-number prefix and a matching sweep in
  `purgeFixtures`: recovery is `pnpm purge:test-data` rather than a manual hunt.

### U3 · Placeholder contact details are worse than empty ones

`settings.store` shipped with `info@biocode.com`, `+383 40 000 000` and three social URLs under
`/biocode` — a domain nobody registered, a number that dials nowhere, accounts that do not exist.
All of it rendered on the live contact page.

The fix is not to invent better-looking values. Every surface renders these conditionally, so
**empty means "not shown" while wrong means "shown wrong"**, and on a shop that sells cash on
delivery a phone number nobody answers costs a sale and a complaint. The email moved to the domain
that exists; the rest is blank until the owner fills it in.

The general form: seed data that looks plausible is more dangerous than seed data that looks
obviously absent, because only one of the two survives review.

### U4 · Two compliance lists, and the one the writer cannot see

The 16 goal intros are health claims. They were written against the same banned-verb list the
BioHack editor enforces (`src/lib/claims.ts`), and checked with it — in both locales, which
matters because the Albanian is what the market reads and an English-only check would cover the
half fewer customers see.

The legal pages are a different problem and it is worth naming the difference. Engineering can
write a privacy policy that is *more* accurate than a template, because the facts are in the
codebase: what is collected, which processor receives it, how long it is kept. What engineering
cannot supply is whether the document is sufficient under Kosovo law, or the trader's registration
details. So the copy is written, and both pages carry a visible `[BIZNESI: plotëso]` marker where
only the owner can finish — a gap that stays legible rather than a document that looks complete.

---

## V. What proving email actually works taught us

### V1 · Two readers of one `.env` file disagreed, and only one value showed it

Next loads `.env.local` through `@next/env`, which follows dotenv and **strips a wrapping pair of
quotes**. The suites and scripts run outside Next and use `envFromLocalFile`, which did not. So
the application read

    BIOCODE <porosite@shtrejt.com>

and every script read

    "BIOCODE <porosite@shtrejt.com>"

For eleven variables that difference is invisible, because nothing else in the file is quoted —
quoting is only *required* for `EMAIL_FROM`, whose value contains spaces and angle brackets.

Which meant the one place the discrepancy surfaced was `pnpm email:test`, the tool whose entire
job is to prove email works. It posted the quoted string as the `from` address and Resend
answered `422 Invalid \`from\` field`. Confirmed by sending both forms: the unquoted one is
delivered, the quoted one is rejected.

The lesson is not "strip quotes". It is that **a second reader of a config format is a second
implementation of that format**, and it will agree with the first everywhere except the one value
that exercises the part you did not implement. `envFromLocalFile` now matches dotenv's quoting
rule and has its own unit tests.

The same trap is waiting in the hosting dashboard, from the other direction: Vercel stores the
literal string, so quoting `EMAIL_FROM` *there* reproduces the 422 in production. `.env.example`
now says so at the line.

### V2 · Three hundred and nineteen log rows, zero sends

`email_log` held 319 rows: 318 `skipped_test_recipient`, one `skipped_no_provider`. Not a single
`sent`, ever.

Every one of them is correct behaviour — the E2E suite mails `@biocode.test` addresses and §S1's
guard refuses them before the provider. But the consequence is worth stating plainly: **a green
suite, a verified domain and a valid API key together prove nothing about whether email works.**
The suite asserts a row exists in `email_log`, deliberately without asserting its status, so it
passes identically whether the provider is perfect or absent.

What closed the gap was two sends to `delivered@resend.dev`, Resend's sandbox address — one
through the script and one through the real runtime path (`POST /api/newsletter` → `sendEmail` →
`email_log`). Both reported `delivered`, and the second wrote the first `sent` row this project
has ever produced. The sandbox address matters: it exercises the whole path without mailing a
person and without the bounce risk that §S1 exists to prevent.

Inbox placement is still unproven and cannot be proven from here — whether a message lands in the
inbox or in spam depends on the receiving provider. That half needs a human with a Gmail account,
which is why `pnpm email:test` prints a checklist rather than a pass.

### V3 · A warm build cache hid a broken cold build, on Windows only

`pnpm build` had been passing all session. Deleting `.next` and building from scratch failed:

    [TypeError: Cannot read properties of null (reading 'useRef')]
    Error occurred prerendering page "/404"

…preceded by 560 warnings about "multiple modules with names that only differ in casing".

`useRef` of null means two copies of React, and the casing warnings say why. The cause was one
line in `node_modules/.modules.yaml`:

    virtualStoreDir: C:\Users\Administrator\projects\shneta\node_modules\.pnpm

Lowercase `projects`, where the project actually lives at `Projects`. Somebody had run
`pnpm install` from a shell whose working directory was cased differently — harmless on Windows,
which does not care, right up until webpack does. It resolved Next's loaders through the lowercase
path and the modules they loaded through the correct one, so every shared module existed twice and
React's hook dispatcher was null in one of them.

`pnpm install` from the correctly-cased directory rewrites the line and the cold build is clean.
No lockfile change, no code change.

Three things worth keeping:

- **It was invisible with a warm cache.** Every green build this session was genuine and none of
  them could have caught this, because the cached module graph already had one consistent casing.
  A cold build is a different test, and the only ones that run cold are CI and Vercel.
- **CI was never affected.** Vercel clones into `/vercel/path0` — one casing, fresh every time —
  and its log for the same commit reads `✓ Compiled successfully in 46s`. This was purely local.
- **The failure named the wrong thing.** "Cannot read properties of null (reading 'useRef')" while
  prerendering `/404` points at a React component; the actual fault was a path in a package
  manager's metadata. When a hooks error appears on a page with no hooks worth suspecting, count
  the copies of React before reading the component.

---

## W. What building the merchant portal taught us

### W1 · A tool that only ever saw the first CTE in a chain

`pnpm check:sql` refused migration 32 with three problems, all of the same shape:

    SQL function public.variant_buy_box() reads "biocode", which is created nowhere in the migrations

`biocode`, `live_offers` and `winner` are CTEs in that function's `with` clause. The checker already
had CTE detection, and it matched exactly one of the four — `wanted`, the first.

The pattern was `\b(?:with|,)\s+([a-z_]\w*)\s+as\s*\(`. A chained CTE is written

    … ), biocode as (

where the character before the comma is `)`. Both `)` and `,` are non-word characters, so there is **no
word boundary between them**, and `\b` made the comma branch unmatchable in the one position it exists
to handle. Any function with two or more CTEs would have been reported as reading tables that do not
exist.

Two things worth taking from it. The check was **right to exist and right to fire loudly** — a
`language sql` body really is validated at CREATE time, and the migration really would fail on apply if
those were tables. And the fix was verified in both directions: the four CTEs are now recognised, and a
throwaway migration reading a genuinely absent table is still caught. A relaxed matcher that stopped
catching anything would have looked identical from the terminal.

### W2 · `pnpm db:types` deleted the types it was meant to write

The script was

    supabase gen types typescript --local > src/lib/supabase/database.types.ts

and there is no local stack running on this machine. A shell truncates the redirect target **before**
the command runs, so one invocation removed 4,376 lines and reported a failure that looked like it had
changed nothing. `pnpm typecheck` then produced several hundred errors in files nobody had touched.

It is now `tsx scripts/gen-types.ts`, which generates into memory and writes only on success — so a
failed run leaves the file alone, which is what a failed command should do. It also refuses a
*successful* run whose output has no `public:` schema in it, because the CLI prints a valid-but-empty
`Database` type when it cannot introspect, and writing that is worse than writing nothing: it
typechecks.

One Windows detail, recorded because it will come up again: the Supabase CLI is a `.CMD` shim, and
since Node 20 closed CVE-2024-27980 spawning one without a shell fails with `EINVAL`. Passing an
argument array *with* `shell: true` then earns `DEP0190`. A single literal command string through
`execSync` is the honest form of what actually happens.

### W3 · The router that forgets which language you are working in

The E2E journey created an offer at `/en/merchant/offers/new` and then asserted the list showed "In
review". It found "Në shqyrtim".

`useRouter` from `next/navigation` pushes the path verbatim, so `router.push('/merchant/offers')` sent
an English-speaking merchant to the unprefixed — Albanian — route the moment their offer saved. The fix
is next-intl's `useRouter` from `@/i18n/routing`, which carries the active locale.

This is the same defect the account layout's `localizedRedirect` note describes, one layer up, and it
has a property that makes it worth its own entry: **it is invisible to anyone developing in the default
locale.** Every manual check of this form passed. Only a test that deliberately worked in `en` could
see it, which is an argument for E2E journeys that do not all run in the default language.

`document-upload.tsx` deliberately keeps the plain router: it only calls `refresh()`, which takes no
path and therefore has no locale to get wrong.

### W4 · Two E2E files sharing one rate-limit block

`e2e/helpers/accounts.ts` carries an allocation table for the `x-forwarded-for` blocks each spec file
uses, and a comment explaining that two specs sharing a block is "the same bug one step removed".
`biohack.spec.ts` and `content.spec.ts` were both on `233.252.4`.

Nothing was failing, because neither file signs in often enough to reach five attempts per fifteen
minutes on its own. It would have started failing when one of them grew, and the failure would have
been a sign-in refusal in a test about something else entirely.

The list is now complete rather than partial — every block through `233.252.9` is named, including the
two that collided. A convention that is only written down for the first few cases is a convention that
stops being followed.

### W5 · A bundle budget earning its keep

The documents screen uploads to Storage from the browser, which needs `@supabase/ssr` and
`supabase-js`: about 80 kB. A static import put them in that page's first load and `pnpm check:bundle`
failed at **215 kB against a 170 kB budget**.

Importing the client inside the click handler moved it to a lazily fetched chunk and the page is 133 kB.
Nobody needs those bytes until they have chosen a file, so nobody downloads them until then.

Worth recording because the budget check is the only thing in the pipeline that would have noticed. The
page rendered correctly, every test passed, and the cost was invisible in every other signal.

### W6 · The pricing decision, and why the buy box does not set a price

Recorded here rather than only in docs/16 §5, because it is the kind of decision that gets quietly
reversed by somebody who did not know it was one.

**The canonical variant price is the only customer-facing price.** A merchant offer is supply, and its
`price_cents` is what the merchant asks BioCode. The alternative — the winning offer prices the line —
fails on a fact about the ordering of events: routing happens *after* the order exists, so the merchant
who priced the line need not be the merchant who ships it, and the customer would have paid a price
belonging to a supplier who never touched the parcel. It would also have put a different price on the
PLP and the PDP the moment BioCode ran out of something.

The consequence to accept knowingly: a merchant asking more than settlement pays is a real possibility,
and BioCode absorbs the difference on any order routed there. That is why the asking price is on the
review screen in cents, next to what settlement pays, with the gap named.

### W7 · A buy box that cannot be bought from is not a lie unless you render it

Step 3 in the §12 build order is "portal shell + offers CRUD + admin offer approval + **buy box on
PDP**", and step 4 is routing. But `checkout_create_order` requires BioCode `inventory_levels` stock,
so merchant supply is not purchasable until step 4 extends it — and extending checkout without routing
would create orders nobody could accept, ship, or settle.

So the selection is complete, tested and live, and the PDP renders the seller line **only on a variant
that can actually be bought**. Nothing on the page states something the system cannot honour, and the
E2E suite asserts the merchant-only case renders as out of stock — so when step 4 changes that, the test
changes with it deliberately rather than by accident.

The general form: when a slice would require a UI to promise something the next slice implements, render
less rather than promising it.

---

## X. What finishing the marketplace taught us

### X1 · plpgsql deferred a cast until the first customer order

`route_order` wrote

    case when v_group.kind = 'biocode' then 'assigned' else 'unassigned' end

into a column of type `fulfilment_status`, and Postgres refused it: `column "status" is of type
fulfilment_status but expression is of type text`. A bare `'assigned'` in the same position would have
been coerced — wrapping it in a `case` resolves the unknown-type literals to `text` and takes the
coercion away.

The trap is the one this project has now hit three times (docs/16 §2): **plpgsql validates a function
body at first execution, not at `create`.** The migration applied perfectly, `check:sql` passed, and the
defect surfaced as a failed checkout — that is, on the first order anyone placed.

The lesson is not "cast your enums". It is that a plpgsql function is not tested by applying it, and the
routing integration suite existing *before* the screens is what turned a production incident into a red
test.

### X2 · A `returns table` signature that had to match exactly

`fulfilment_candidates` declared `merchant_slug text`. `merchants.slug` is `extensions.citext` —
deliberately, so `/seller/alpha` and `/seller/Alpha` are the same merchant. `return query` will not widen
citext to text on the way out, and the call died with `structure of query does not match function result
type`.

Worth pairing with §X1 because the same function file contained a `language sql` sibling,
`variant_buy_box`, that returns `merchant_slug text` from the same column and works — its outer `select`
list coerces. Two functions, same column, same declared type, one works.

`::text` on the projection rather than `citext` in the signature: the callers are TypeScript, which has
one string type, and a signature naming a Postgres extension type for no caller's benefit is an
implementation detail leaking outward.

### X3 · Restating a 250-line function silently discarded a fix five migrations later

Extending checkout to source a line from a merchant meant reproducing `checkout_create_order` in full —
`create or replace function` has no partial form. Reproducing it from **migration 08**, which defined it,
silently reverted **migration 13**, which had changed `set search_path = public` to `public, extensions`.

One missing schema breaks exactly one thing, invisibly. `coupons.code` is `citext`; the cast in the
comparison is schema-qualified and resolves, but the `=` *operator* for citext also lives in `extensions`
and cannot be qualified inside an expression. Postgres cannot see `=(citext, citext)`, citext is
binary-coercible to text, so it silently resolves `=(text, text)` — no error, no warning, just a
case-sensitive comparison, and `welcome10` stops matching `WELCOME10`.

Two things follow.

**A function's current definition is not any one file.** It is the accumulation, and only the database
knows it. Restating one means reading `\df+` or the latest `alter`, not the migration that created it.

**The test that caught it was written when the bug was first fixed**, and its docstring says so:
*"Fixed by migration 20260731001300; this test is what stops it coming back."* That is the entire
argument for writing the regression test with the fix rather than after it — five milestones later,
somebody who had never read migration 13 was told within ninety seconds.

### X4 · `desc` implies `nulls first`, and the tie-break lost to the row with no value

The bulk-update matcher said, meaning "the merchant's own code wins when both match":

    order by (lower(o.merchant_sku) = lower(v_sku)) desc

For an offer with `merchant_sku is null`, that expression is `null` — not `false` — and `desc` places
nulls **first**. So a merchant uploading its own SKU updated whichever offer happened to have no SKU at
all.

Two notes worth keeping. A `case … then 0 else 1 end` says what is meant without a modifier that has to
be remembered. And the test that found it had to construct a real collision — one offer whose merchant
code equals another offer's BioCode code — because with a single candidate the wrong ordering still picks
the right row. A test that merely exercised the feature would have passed.

### X5 · Vitest resolves `server-only` to the entry point that throws

Every module in `features/*` that touches the database opens with `import 'server-only'`. The package
ships two entry points: a no-op for the server and a module that throws for the browser, chosen by
`exports` conditions Next sets and Vitest does not — so Vitest's **node** environment gets the browser
one, and any test importing such a module dies with *"This module cannot be imported from a Client
Component module"* before its first line runs.

The consequence was not subtle: none of the email senders could be tested at all, which is how an email
ships addressed to the wrong person.

Aliased to an empty stub in `vitest.integration.config.mts` **only**. The guarantee `server-only` exists
for is about the client bundle — it stops a module holding a service-role key from being shipped to a
browser — and `next build` is what enforces that. A node test runner is not a browser, so the stub
removes nothing real. The unit config deliberately has no such alias: nothing there touches the database,
and a unit test reaching for a server-only module is a sign the module boundary is wrong.

### X6 · Two a11y failures that only appear with real data

Both were found by running axe against the eleven new screens **populated**, and neither would have been
found against an empty state.

**`definition-list`, serious.** A `<dl>` may contain `<dt>`, `<dd>` and `<div>` wrappers, and a `<div>`
inside one may contain only `<dt>` and `<dd>`. Every stat card in the portal had a sibling `<p>` for its
hint, which makes the list invalid. Moving the hint inside the `<dd>` fixes it and reads better anyway —
the hint describes the value, so it belongs with it.

**`color-contrast`, serious.** "In the buy box" was `text-lime-500`. Lime is the brand accent: `#a3e635`
on the cream surface is about 1.8:1, against the 4.5:1 AA needs for small text. It belongs on the focus
ring and on dark backgrounds, which is exactly where docs/04's palette puts it — this was reaching for a
brand colour because the badge felt like it should be branded. The same mistake as docs/13 §C, in a new
place.

A third, `scrollable-region-focusable`, appeared only at 390 px: an `overflow-x-auto` container scrolls
with a finger and **cannot be reached by a keyboard at all**, so the right-hand columns of a wide table
are unreachable without a pointer. `ScrollRegion` now wraps every one of them with `tabIndex={0}`, a
`role="region"` and the table's own caption as its name — a focusable div with no accessible name is a
tab stop that announces nothing.

### X7 · The half of "purchasable" that was missing for two steps

Migration 35 taught `checkout_create_order` to source a line from a merchant when BioCode is short. The
PDP kept reading `v_product_stock`, which answers "can BioCode ship this?" — so a variant a merchant was
holding rendered as **out of stock on a page whose checkout would have sold it**, and `addToCart` refused
what checkout would have accepted.

Nothing failed. The integration suite passed, because it called the RPC directly. The E2E assertion that
caught it was the one written at step 3 to say *"a merchant-only variant is out of stock and names no
seller"*, with a note that the day this changed the test would change with it deliberately — and when
step 4 arrived, inverting that assertion is what exposed that only half the change had been made.

An assertion about behaviour you intend to change later is worth writing precisely because it fails when
you change it.

### X8 · A seed whose comments described a database it had not read

The marketplace demo seed set up two merchants on overlapping SKUs and explained, in a header comment,
which variant would demonstrate which buy-box rule. Three of the four claims were wrong: the commerce
seed stocks **every** variant, so BioCode won all of them and not one merchant offer was ever selected.

The fixture ran, inserted every row, and demonstrated nothing. It was caught by querying
`variant_buy_box` after seeding rather than by reading the file — which is the only way it could have
been caught, since the file is internally consistent and its comments are confident.

The seed now takes two variants to zero through `apply_stock_movement`, which is both realistic — a shop
out of stock on two lines with suppliers who are not is the state the marketplace exists for — and
consistent with the ledger invariant a bare `UPDATE` would have broken (docs/13 §A7).

### X9 · The guard refusing the seed was the guard working

`guard_merchant_offer_write` refuses `status = 'approved'` from anyone who is not staff or the service
role. A seed file runs as `postgres`, which is neither — `is_service_role()` reads a JWT claim and
`has_any_role()` reads `auth.uid()`, and a psql session has neither — so the first approved offer in the
demo seed raised `OFFER_STATUS_FORBIDDEN` and the file failed.

The tempting fix is to insert drafts and update them afterwards, which passes the trigger while meaning
exactly the same thing. The seed instead sets `request.jwt.claims` to declare what it is doing, and
resets it at the end. A workaround that hides its own intent is worse than a line that states it.

### X10 · Where the marketplace's own money invariant lives

Recorded because it is the thing most likely to be broken by a well-meaning change.

**`merchant_ledger.amount_cents` is signed, and the balance is `sum(amount_cents)` over every row
including payouts.** A payout row is negative, so a settled fortnight leaves nothing behind and there is
no "unpaid" flag anywhere that can fall out of step with the total.

The consequences worth knowing before touching it:

- building a payout must post its own balancing row, or the balance will not move;
- a second build of the same period must find nothing, which is what makes a daily cron safe;
- marking a payout *paid* must post nothing, because the money left the balance when it was *built*;
- there is no update or delete policy on the ledger for anyone, including admin. A correction is another
  row — the same discipline as `stock_movements`, and the reason a statement can be trusted.

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

1. **The Signal Ring is a Server Component with a CSS animation.** It appears above the
   fold on Home, PLP and PDP, so it must not be the reason Framer lands on the critical
   path. `@keyframes signal-draw` produces the identical 400 ms ease-out-quint draw-in,
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
