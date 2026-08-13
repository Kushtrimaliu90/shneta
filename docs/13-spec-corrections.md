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

### X11 · The proposal field that is free text on purpose, and the enum it lands in

`promote_proposal_to_draft` writes `payload->>'form'` into `products.form`, which is `product_form`.
plpgsql accepted `create or replace` and complained on the first call — the same deferred-validation trap
as §X1 and §X2, three times in one milestone. The lesson is recorded there; what is worth recording here
is that **the obvious fix was worse than the error**.

A bare `::product_form` throws on any value outside the ten enum members, and the proposal form asks for
the form as free text *deliberately* — a merchant knows forms BioCode does not, and "effervescent
tablets", "drops" and "pluhur" are all reasonable answers. So a reviewer approving a perfectly good
proposal would have seen the promotion fail, in a way that looks like broken software rather than a
free-text field meeting a closed set.

The value is now taken **only when it names an enum member** (case-insensitively, with a trailing "s"
dropped so "Capsules" lands on `capsule`), and left null otherwise. Nothing is lost: the merchant's own
words are still in `payload.form` and still on the review card, and the reviewer picks the closest form in
the editor — a judgement they were always going to make.

The general rule: when free-typed input meets a closed set, coerce what matches and **carry the rest
forward as text for a human**. Refusing the input teaches users to guess at your vocabulary.

### X12 · Restating a legal document in a seed nearly deleted thirteen clauses

Adding clause 14 to the marketplace terms meant editing a `legal_documents` row whose body is one jsonb
blob per locale. The first draft of the seed was an `insert … on conflict … do update set body = <new>`,
with the new body containing clause 14 — and clauses 1 through 13 nowhere, because they were never in the
file. It would have applied cleanly and silently replaced the whole agreement with one paragraph.

Caught before it ran, by asking what the row contained rather than what the file said. The seed now
**appends**: it concatenates clause 14 onto the existing body, rewrites only the version line, and guards
itself with `and body->>'en' not like '%14. Images and content the Seller supplies%'` so re-running is a
no-op.

Two things generalise:

- **A seed that owns a whole column owns everything already in it.** `do update set body = …` is a
  replacement, and for content nobody re-derives from source — legal text, editorial copy, translations —
  the safe shape is an append with an idempotence guard.
- **Bumping a document's version is not the same as getting it accepted.** `terms_version` on existing
  merchants still reads `1.0`, and there is no re-acceptance flow. That is a real gap, not a detail; it is
  in docs/14 §19 so it is not discovered by a lawyer.

### X13 · `reuseExistingServer` will happily reuse a server older than the build

The first run of the new proposal-images journey failed with
`waiting for locator('#proposal-images')` — and the screenshot showed the proposal form **without the
uploader**, rendered with no CSS at all.

Nothing was wrong with the component. `playwright.config.ts` sets `reuseExistingServer: !CI`, a `pnpm start`
from seven hours earlier was still listening on 3000, and `pnpm build` had since overwritten `.next`
underneath it. So the server kept serving the *old* compiled app from memory while its asset URLs pointed
at hashes that no longer existed — hence a live page missing a feature, with its stylesheet 404ing.

The tell is the **unstyled page**, not the missing element: a selector bug does not remove the CSS. When an
E2E failure claims an element that exists in source is absent, check what is actually listening on the
port before reading the component:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  ForEach-Object { Get-Process -Id $_.OwningProcess | Select-Object Id, StartTime }
Get-Item .next/BUILD_ID | Select-Object LastWriteTime   # server older than this ⇒ stale
```

A sibling of §N10, and the same root cause: **one build directory, several processes with opinions about
it.** §N10 is "do not rebuild while the suite is running"; this is "do not run the suite against a server
that predates the build". Killing the listener and letting Playwright start its own fixed it, and the same
test passed in 17 s.

### X14 · `seed:users failed: klienti@biocode.dev: {}`

Two bugs in one line, and the second one hid the first.

**The error had no content.** `AuthRetryableFetchError.message` is the HTTP response body run through
`JSON.stringify`, so an empty body arrives as the literal string `{}`. The script printed
`${user.email}: ${error.message}` and produced a failure nobody could act on. `error.name` and
`error.status` were populated the whole time — `AuthRetryableFetchError`, `500`. **Never report an API
error by its message alone**; a `describeAuthError` helper now prints the name and status and says
`(empty response body)` when that is what happened.

**And the real defect: GoTrue answers a duplicate id and a duplicate email differently.**

| Conflict            | Response                                     |
| ------------------- | -------------------------------------------- |
| Email already taken | `422` · `"email address has already been registered"` |
| **Id** already taken | **`500` · empty body**                       |

`upsertUser` decided "already there, reconcile it" by sniffing the message for
`/already|registered|exists|duplicate/`. That is exactly backwards for a script whose whole point is
**fixed UUIDs**: the re-run where nothing changed passed (the email collides, the message says
"already"), and the one case that needed work — an account whose address this script has since changed —
threw. The BIOCODE rebrand left `klienti@shneta.dev` on id `…007`, so `createUser` collided on the id
alone, got the 500, matched nothing, and died. Six accounts had already been renamed; the seventh could
not be, and the two merchant fixtures behind it were never created at all.

The fix inverts the question: **look the id up, then create or reconcile**, keyed on the 404 status
rather than on the words "User not found". A `createUser` failure now means something real and unambiguous
— the id was free and the *email* was not, i.e. it belongs to a different account — and it says so.

The general rule, and it is the same one twice: **branch on an API's status codes and identifiers, never
on its prose.** Message text is for humans, and it changes without warning; here it did not even exist.

#### The output was also about to lie

A run that creates two accounts and leaves seven untouched printed the new password under
`Password for all 9 accounts:`. Seven of them still had the old one. The report now names the accounts the
printed password actually belongs to, and states that the rest kept theirs — the kind of wrong that costs
somebody twenty minutes of "the password doesn't work".

### X15 · A zero-row UPDATE is a success, so the action reported work it had not done

`attachBatchImages` wrote `product_proposals.payload` through the merchant's own session and reported three
photographs attached. **Zero rows had changed.**

`p_own_update` is `using (merchant_id = any (current_merchant_ids()) and status = 'needs_info')` — a merchant
may edit a proposal a reviewer sent *back*, and nothing else. That is correct and worth keeping: a pending
proposal must not change under the reviewer reading it. But a batch's photographs arrive **after** its rows
by design, so the one write the merchant legitimately needs was the one the policy forbade.

Two things made it silent:

- **PostgREST answers an UPDATE that matched nothing with success and no error.** RLS does not raise on a
  filtered-out row; it removes the row from the statement's scope, and an UPDATE with no matches is a
  perfectly ordinary UPDATE.
- **The action counted its own intent.** It computed `merged.length - current.images.length` from what it had
  read and meant to write, never asking the database what it had actually written.

The fix is a `security definer` function that permits exactly one change — appending paths — and returns
`{attached, rejected}`. A wider policy was the wrong instrument: admitting `status = 'pending'` would let a
merchant rewrite a pending proposal's name, brand and price while it sits in the queue.

Two rules worth keeping:

1. **Report what the database says you changed, never what you intended.** Use `.select()` on a mutation, or
   a function that returns a count. An optimistic count is a lie with a green tick next to it.
2. **When RLS forbids a write the product genuinely needs, name the write.** A guarded RPC that allows one
   field is a smaller hole than a policy that allows a status.

What caught it was the E2E journey reading the rows back out of the database instead of trusting the
"Attached 3 photograph(s)" the screen showed. An assertion against your own success message asserts nothing.

### X16 · A feature that starts creating rows makes every existing teardown wrong

§9 changed approving a proposal from "records a decision" to "records a decision **and creates a draft
product**". Every test that approved a proposal therefore started creating catalogue rows, and none of them
knew it. **Forty draft products accumulated on the shared project in a single day**, found by counting rather
than by any failure.

Three separate reasons, and each is a different lesson:

1. **The integration teardown deleted in the wrong order.** `product_proposals.created_product_id` references
   `products(id)` with no cascade, so deleting the promoted product while its proposal still pointed at it was
   refused by the foreign key. The loop did not check the error. It left thirty products whose variants *had*
   been deleted — orphans that could never be sold and never be published. **A cleanup loop that ignores its
   errors is a leak with a green tick.** It now throws.
2. **The E2E test predated the change and registered nothing.** `a merchant proposes a product and a reviewer
   answers` was written when approval created nothing, so it tracked nothing for cleanup. It now reads
   `created_product_id` back and registers the product and its brand.
3. **The purge could not see them.** It sweeps `slug LIKE 'product-%'`, and a promoted draft is slugged from
   the *product name* — `e2e-creatine-431a6f`, `promoted-probe-1785849308525`. The pattern that has caught
   every fixture product since M2 was blind to a new way of creating one. The purge now follows the *link*
   instead: draft products referenced by a fixture merchant's proposals, read before the proposals are deleted
   and deleted after, plus the brands the promotion invented if nothing else uses them.

The general rule: **when a feature starts writing to a table it did not write to before, the fixture cleanup
is part of the feature.** Ask what the new rows are keyed by, and whether any existing sweep can find them —
because slug patterns, name prefixes and email suffixes are all conventions a new code path has never heard of.

#### The same day, the same shape, in storage

Counting again after the row leak was fixed showed **29 objects in the private proposals bucket and 27 under
`product-images`**, growing by five or six per suite run. Rows were clean; bytes were not. Two causes:

- every storage sweep in `purge.ts` removes objects for rows *it* is deleting, and a spec that tidies its own
  rows in `afterAll` leaves the bytes — deleting a product cascades `product_images` and says nothing about
  storage;
- nothing had ever swept `merchant-proposals` at all, because before §9 nothing wrote to it from a test.

The fix is keyed on **existence rather than on a pattern**: a folder named as a uuid whose row is gone belongs
to nobody, so it goes. That needs no fixture convention, which means the next code path to write into either
bucket is covered the day it ships — and it is safe for the same reason, since a real merchant's folder and a
real product's folder both still have their row. It cleaned 71 objects on its first run, including one orphan
left by a milestone months earlier.

Two guards it needs, both learned by writing it wrong first: only folder names that **are** uuids (otherwise
`.eq('id', name)` against a uuid column answers 400, `count` is null, and "no answer" reads as "no row"), and
an explicit `if (error) continue` for the same reason.

#### And a comment that claimed a consistency it did not have

`copyImages` wrote `products/<product_id>/…` under a comment saying that was where the product editor puts its
uploads, so a promoted image would be indistinguishable from a hand-added one. The editor actually signs
`<product_id>/<uuid>.<ext>` — no prefix segment. Nothing broke: `product_images.storage_path` holds the full
path, so rendering and deletion both worked. But the bucket had two conventions, the sweep that has cleaned
`<product_id>/` since M2 could not see half of them, and the comment asserting otherwise is the kind that
survives review precisely because it sounds like it was checked.

Promotion now writes the editor's path. **A claim about consistency is worth exactly one grep**, and this one
was never run until a storage listing showed a folder that should not have existed.

And the reason it was worth chasing at all: drafts are invisible to customers, so nothing was broken. It was
purely junk accumulating in `/admin/products` at about seven rows per test run, on the one project that is
also production (§7).

### X17 · The test suite puts its fixtures on the customer-facing storefront

Reported as "the category list contains test-related names": `Emri Provë`, `Kategori e Zënë`, `Prindi` —
Albanian for *Test Name*, *Taken Category*, *Parent* — each appearing **twice** in the shop's category
sidebar, on the live site.

They were not catalogue rows. They were **E2E fixtures, live, while the suite was running.** The admin
taxonomy journeys create categories to test creating categories; the desktop and mobile projects each make
their own, which is why each name appeared twice; and the global teardown removes them at the end of the
run. Between those two moments — about twenty-five minutes — every visitor to the shop sees them, because
one Supabase project serves dev, test and production (§7 of docs/14).

The teardown line at the end of that run is the whole story:

    purged fixtures — categories: 6, categories (children): 2, brands: 10, health_goals: 2, …

**Nothing here is a bug in the code**, which is what makes it worth writing down. The fixtures are correctly
named, correctly scoped and correctly cleaned. The purge works. The tests are right to create them. What is
wrong is the *arrangement*: a suite that must create a category to prove creating a category works cannot
share a database with customers.

Three things follow:

1. **This is now the strongest argument for the environment separation in docs/14 §7**, ahead of the
   destructive-purge risk that was previously the headline. A purge that deletes real data is a disaster
   that has not happened; test data on the shop floor is a defect that is happening on every run.
2. **The window is the exposure**, so shortening it has value even before separation: a fixture cleaned up
   by the test that made it is visible for seconds instead of for the length of the suite. Where a spec
   creates catalogue rows that render publicly, the cleanup belongs in that spec, not only in the global
   teardown.
3. **Do not "fix" it by making fixtures invisible** — deactivating them, or filtering fixture slugs out of
   the storefront query. Both would weaken the tests to protect production from the tests, which is the
   wrong direction: the assertion that a new category *appears* is exactly the one worth keeping.

The diagnosis also corrected the report. The names looked like leaked rows and were assumed to be leaked
rows; counting them after the suite finished showed zero. The genuine catalogue leak was one row — a brand
called `The Governor`, from a manual admin test weeks earlier, invisible to every purge pattern because its
slug came from its name. That is §X16's lesson again, and seed 12 removes it.

### X3 (again) · Restating a function dropped a fix, in the migration whose comment cites §X3

Migration 47 restated `merchant_bulk_update_offers` as `merchant_bulk_upsert_offers` and copied the body from
migration 39 — which still carried `order by (lower(o.merchant_sku) = lower(v_sku)) desc`. Migration 40 had
already replaced that with a `case` expression for the reason in §X4: **`desc` implies `nulls first`**, so an
offer with no `merchant_sku` sorted above the offer that matched on the merchant's own code.

The migration's own header comment cites §X3 and warns about exactly this. **Reading the warning is not the
same as checking.** What caught it, within a minute of the push, was the regression test written when §X4 was
first fixed — `matches the merchant's own SKU in preference to BioCode's`.

Sharper form of the rule: a restated function is the accumulation of *every* migration that ever touched it.
Before restating one, `grep` the function name across `supabase/migrations/` and read every hit in order — or
better, do not restate. And keep the test that pins the behaviour, because it is the only thing that notices.

---

## Y. What building the referral programme taught us

### Y1 · `array || 'literal'` is not array-append, and the exception guard hid it

`link_referral` collects risk flags before inserting a link:

```sql
v_flags text[] := '{}';
…
v_flags := v_flags || 'same_address';   -- looks obvious, is wrong
```

With an untyped literal on the right, Postgres resolves `||` to `anyarray || anyarray` rather than
`anyarray || anyelement`, and tries to parse the string as an array literal:

```
malformed array literal: "rapid_signup"
Array value must start with "{" or dimension information.
```

So every link that *should* have carried a flag was instead **not created at all** — the exact population a
fraud review exists to look at. Use `array_append(v_flags, 'same_address')`, which has one meaning, or cast
the literal.

**The part worth remembering is why it was nearly invisible.** `handle_new_user` calls `link_referral` inside
an exception guard, deliberately, so that a referral bug can never stop somebody registering:

```sql
begin
  perform public.link_referral(new.id, v_code, v_source);
exception when others then
  raise warning 'referral link failed for %: %', new.id, sqlerrm;
end;
```

That guard is right and stays. But it converts "the flag logic is broken" into "some referrals silently do not
exist", and nobody audits referrals that were never created. In production the symptom would have been a fraud
panel that never flagged anything — which reads as *good news*.

The rule this yields: **a swallowed exception needs a test that asserts the work happened, not just that the
caller survived.** The test that found this asserts `risk_flags` contains `same_address`, not merely that the
account was created. The three-line fix was migration 57; the test was written in the same hour, which is the
only reason the bug lasted twenty minutes rather than reaching a customer.

Corollary for `plpgsql` generally: this compiled fine at `create` time and failed at first execution, like §X1
and §X15. A function whose error path has never run has not been tested.

### Y2 · Collapsing error messages, and the two that should not collapse

docs/17 §6 requires one generic rejection so the claim endpoint cannot be walked as a code oracle. Applied
literally that produces a form which answers "we can't use that code" when the customer typed **their own**
code, or when they already have a referrer — and both are mistakes real people make constantly.

The distinction that resolves it: **collapse facts about somebody else's code; keep facts about the caller's own
account.** `no such code`, `same phone as the owner`, `would close a cycle` and `owner is at their cap` all
collapse to `invalid`, because each one leaks something about a code the caller does not own. `self` and
`already_linked` are things the caller can already see on their own screen, so saying them plainly reveals
nothing and saves a support email.

`link_referral` therefore returns a precise outcome and `claim_referral_code` decides what may cross the wire.
Putting the collapse in the caller rather than the validator is what lets the admin queue show the real reason
later without touching either.

### Y3 · The invite field must never be the reason an account cannot be created

The code is optional, so the temptation is to accept anything and drop what does not resolve. That loses
referrals silently: a mistyped code is only fixable while the person who typed it is still looking at the field.

So it *is* validated for shape — and the tests pin both halves of the compromise: a present-and-malformed code
is a field error on `referralCode` alone (never a whole-form failure), and an empty field parses clean. Two
tests, and they are there because the failure mode is a sign-up form that rejects customers over a field that
does not matter.

The Zod 4 detail found on the way: `z.union([schema, z.literal(''), z.undefined()]).transform(…)` still
rejects a **missing** key. `.transform()` yields a pipe, and a pipe is non-optional regardless of what its
input union accepts — listing `z.undefined()` parses a *present* `undefined` only. `.optional()` after the
transform is what makes the key itself optional.

### Y4 · One new test file broke twenty tests in files it never touched

`referral-entry.test.ts` passed on its own, then the full run came back:

```
Test Files  8 failed | 11 passed (19)
Tests  20 failed | 304 passed | 79 skipped (403)
Error: sign-in failed: Request rate limit reached
```

Nothing was wrong with the code. `helpers.createUser` ends in `signInWithPassword` so it can hand back a
JWT-carrying client, and Supabase Auth rate-limits that endpoint **per IP** on a hosted project. The suite
already creates around fifty accounts per run; the new file added twenty-one more sign-ins and pushed the
whole thing over. The failures then landed in whichever file happened to be running when the budget ran out —
`referrals.test.ts`, which the change had nothing to do with.

Most of those twenty-one sign-ins were waste: the accounts existed to *own a referral code* or *be a row the
service client reads*, and their clients were discarded. So the file grew a local `createBareUser()` that
creates a confirmed user through `auth.admin.createUser` and stops there, and signs in only the six accounts
that genuinely assert through RLS. 21 → 6.

Two rules out of this:

- **A sign-in is a shared, rate-limited resource, not a free fixture.** Reach for `createUser` when the test
  needs a *customer-context client*; create the account bare when it only needs to exist. Reuse one signed-in
  account across cases that all end in rejection — a rejected attempt leaves nothing behind, so the account is
  still pristine for the next one.
- **A test file that passes alone has not been tested.** This suite is `fileParallelism: false` against one
  shared database precisely because tests interact, and per-IP quota is one of the ways they interact. Run the
  whole suite before believing a new file.

### Y5 · `request.nextUrl.origin` is not the host the visitor typed

The `/r/{CODE}` handler sets a cookie and redirects to the sign-up form. In a browser the field came back
empty, every time, while a `curl` with a cookie jar filled it correctly. The redirect chain said why:

```
307 http://127.0.0.1:3000/en/r/BIO-6S95A -> 200 http://localhost:3000/en/auth/sign-up
cookie: { name: 'biocode_ref', domain: '127.0.0.1', … }
```

The cookie was stored against `127.0.0.1`; the browser then asked **`localhost`** for the sign-up form and,
correctly, sent nothing. The invite disappeared between two lines of code that both read as obviously right.

The cause is that `request.nextUrl.origin` reports the origin **Next computed**, not the `Host` the request
carried — and `request.url` reports the same thing, so swapping one for the other fixes nothing. The fix is to
stop naming a host at all:

```ts
new NextResponse(null, { status: 307, headers: { Location: localizePath(path, locale) } })
```

A relative `Location` (RFC 7231 §7.1.2) keeps the visitor on whatever host they arrived at, so the host that
set the cookie is always the host that reads it.

This is not a localhost curiosity. The same mismatch is `biocode.fit` against `www.biocode.fit`, and every
preview deployment — exactly the URLs a share link gets pasted into. **Any redirect that carries cookie state
should use a relative `Location`.** Where an absolute URL is genuinely required (an email link, a payment
return), it must be built from `NEXT_PUBLIC_SITE_URL`, which is a decision, rather than from the request,
which is a guess.

### Y6 · Two conventions the E2E suite already had, learned again

`referrals.spec.ts` was written with a test that registers through the sign-up form. It failed with
`over_email_send_rate_limit`: the hosted project sends its own confirmation email and rate-limits that to a
couple an hour, so the second run of any such test gets "Something went wrong" and no account. `auth.spec.ts`
had already solved this — its header says the fixtures are built through the service role — and the lesson is
that **a browser cannot create accounts on this project**; the DB half of a sign-up journey belongs in the
integration suite, and the spec should say where the seam is rather than leave it implied.

The second: a test asserted a `Code added` success alert that never renders. The action calls
`revalidatePath('/account')`, the server tree re-renders, `canEnter` turns false, and the card containing the
alert unmounts before it can paint. The customer sees the settled state instead — "Invited by Blerim K." where
the form was — which is the better confirmation. **Assert what the refresh leaves on screen, not what the
action returned**; with server actions plus `revalidatePath` those are routinely different things.

### Y7 · The `eyebrow` utility had a contrast bug in it for eleven milestones

axe on `/account/referrals` reported `ink-500` on `forest-50` at **4.43:1** against a 4.5 floor. The rule
that forbids exactly this was already written down — docs/13 §C, "secondary text on a tint is ink-600,
never ink-500" — and the `@utility eyebrow` in `globals.css` broke it by baking the colour in:

```css
@utility eyebrow { … color: var(--color-ink-500); }
```

`ink-500` clears AA on cream at 4.53:1, so on the page backgrounds where eyebrows were first used it
passed. **142 files use `bg-forest-50`**, and every eyebrow on one of them was a latent failure waiting
for an axe pass to reach that page. Two new pages were simply the first ones covered.

Fixed at the utility rather than at the two call sites, because the other 140 are the same bug and
stepping around it leaves it for somebody else. The generalisation worth keeping:

- **A utility that bakes in a colour has to use the colour that is safe on every surface it is used
  on**, not the one that was safe on the first surface. `ink-600` clears AA on cream, `forest-50`,
  `forest-100` and `surface` alike, and there is now a test that says so by name.
- Rules recorded in prose do not enforce themselves. §C stated this rule in M5 and the utility violated
  it the whole time, because nothing compared the two.

### Y8 · Two links with the same name is a test failure and a real defect

The referrals empty state offered a "referral terms" button, and the privacy note below it linked to the
same page with the same words. Playwright's strict mode refused the ambiguity, which was the useful part:
somebody navigating by link hears the same label twice for one destination.

The fix was to delete the button. docs/04 §9 wants an empty state to say what to do next, and the body
already did — the thing to do is share the link, which is the panel directly above. **Strict-mode
ambiguity is worth reading as a design note rather than routing around with `.first()`.**

And the mistake made while fixing it, because it costs a build every time: `{/* … */}` cannot open a
ternary branch in JSX. `cond ? {/* c */} <X/> : …` parses the comment as an object literal and fails with
`Expected '</', got …`. The comment goes above the expression.

### Y9 · A `having` clause that read like an optimisation and encoded a false condition

The monthly referral true-up looped over referrers with:

```sql
group by l.referrer_id
having coalesce(sum(e.points), 0) <> 0   -- "skip anyone with nothing to pay"
```

That is not what needing a true-up means. The condition is `earned <> already_posted`, not `earned <> 0`,
and the difference is exactly the case the true-up was built for:

```
earn 50  → posted, wallet holds 50
spend 40 → wallet holds 10
refund   → earnings net to 0
```

Owed is `0 − 50 = −50`, floored to the balance, so 10 points should come back. The `having` excluded the
referrer — their earnings summed to zero — and the wallet kept 10 points for an order that was returned.
**Silently and permanently**: no later run would revisit them either, because their earnings stay at zero
for ever.

Removed rather than corrected: the per-referrer `owed = 0 → continue` inside the loop already skips
everybody with nothing to do, so the clause was a premature optimisation that happened to be a wrong
predicate. The generalisation: **when a query filters on a proxy for the real condition, the proxy is
what will be wrong.** `sum <> 0` was standing in for "differs from what we paid", and the two agree on
every case except the one that matters.

Found by a test written specifically to describe that sequence. It would not have been found by a test
that only checked "earn, post, earn again, post again".

### Y10 · `split_part` on a string that starts with the delimiter

`mask_person_name('  Arta Berisha')` returned `një klient` — the generic label a customer with no name
gets. `split_part('  Arta Berisha', ' ', 1)` is the **empty string**, because the first field of a string
beginning with the delimiter is empty; `nullif(trim(''), '')` is null, the concatenation collapses to
null, and `coalesce` falls through.

So a customer who typed a leading space into their name appeared to every referrer as "a customer", and
`'Arta   Berisha'` failed the same way one field along. Fixed by normalising before splitting:

```sql
nullif(regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g'), '')
```

Worth remembering because the input is a free-text field a person typed on a phone, and `trim` alone is
not enough — `split_part` cares about *internal* runs too. Any `split_part` over user-entered text wants
whitespace collapsed first.

### Y11 · Adding photographs broke two buttons, because a component's two branches had different layout

The compare table's remove button and the subscriptions page's Pause button both stopped working. Neither
is near an image in the markup. Playwright said exactly what was wrong, in the clearest words anybody
wrote about it:

```
- element is visible, enabled and stable
- <img sizes="48px" data-nimg="fill" alt="NOW Vitamin D3 4000 IU" …>
    from <ul class="mt-2 flex flex-col gap-2"> subtree intercepts pointer events
```

A 48-pixel image was covering an entire `<ul>`. `ProductImage` had two return branches with **different
layout semantics**:

- no photograph → a `<div>` carrying `className`, an ordinary in-flow box sized by `size-12`;
- a photograph → a bare `<Image fill>`, which is `position: absolute; inset: 0` and therefore ignores
  `size-*` for positioning entirely. It fills the nearest **positioned ancestor**.

Call sites that wrapped it in a `relative` box were fine. The ones that passed `size-12 p-1` and expected
an in-flow box got an image stretched across whatever container happened to be positioned further up the
tree — in one case a whole list, swallowing every click in it.

**This was latent from M3 and could not surface until M13**, because the catalogue had no photography: every
product rendered the in-flow fallback, so the broken branch was unreachable. It appeared the day real
images landed, in two places at once, in features nobody had touched.

Fixed in the component: the wrapper is always rendered and always `relative`, `className` sizes *it*
(which is what every call site already meant), and `inset: 0` resolves against its padding box so `p-2`
still insets the photograph exactly as before. `object-cover` became an explicit `fit` prop, because a
class name landing on the wrapper would be silently inert.

Two rules out of it:

- **A component with a conditional root must render the same kind of box in every branch.** If one branch
  is in-flow and another is absolutely positioned, every call site is coupled to which branch it happens
  to get — and that is data, not markup.
- **A fallback that is the normal case is not a tested case.** For eleven milestones `path` was always
  null, so the photograph branch had no coverage anywhere, and the first real data exercised it in
  production-shaped ways nothing had rehearsed. The compare table's remove button had a passing E2E test
  the whole time.

### Y12 · Every literal count in the catalogue spec was a fact about the demo data

Four assertions failed together: `12 products` for the vegan filter, `5 produkte` for a category, and two
`3 products` for a brand and a goal. All true of the 24-product demo catalogue, all false once the real
one landed — 108 products, and one more every time somebody adds a product in the panel.

### Y13 · One reload is not enough to observe a tag purge

`an edit to a brand reaches the storefront immediately` failed about one run in three, and only in a full
suite. The write was not slow — `expectRowName` already confirms the row changed before the storefront is
checked. It is **stale-while-revalidate**: `revalidateTag` marks the cached entry stale, and the first
request after that may still be served the stale copy while regeneration happens behind it. The second
request gets the new one.

So a single `reload()` was asserting something the test never meant to claim — not "the purge happened"
but "the very first byte after the purge is fresh". Reloading inside an `expect.poll` keeps the real claim
and drops the accidental one. 5/5 after, 2/3 before.

Worth generalising, because ISR is used for the whole storefront: **an assertion about a cache purge needs
to be retried, not timed.** A longer timeout on a single request does not help — the stale response
arrives promptly and is simply the wrong one.

This one was not an M13 regression. It surfaced because the full suite had not been run cleanly in a
while, which is its own lesson: a flake that only appears in a full run is invisible to exactly the
workflow that would fix it.

The same file had **already learned this once**: `expectAtLeast(page, /\d+ products/, 24)` exists with a
comment explaining that other specs publish fixtures concurrently, so an exact count is not the assertion.
The lesson was applied to the unfiltered count and not to the four scoped ones.

Updating `12` to the new number would only move the breakage to the next catalogue edit — and a literal
proves nothing about filtering when it passes. Each is now the relationship the test is *named* for:
filtered is greater than zero and fewer than unfiltered; a category, brand or goal page shows fewer than
the whole shop. **When a test asserts a number, check whether the number or the relationship is the
claim.** Here the relationship was always the claim, and the number was a convenient way to spell it that
stopped being true.

### Y14 · The filter panel was an infinite crawl space, and it cost 93% of the database

Vercel reported 22.8M external API requests over three days on a shop with no customers. `pg_stat_statements`
found it in one query:

| calls | statement |
| --- | --- |
| 1,765,834 | `search_products` — goal only |
| 1,466,627 | `search_products` — brand + goal |
| 557,732 | `search_products` — category + brand + goal + tags |
| 4,796,226 | **all `search_products`, of 4,814,468 PostgREST requests total** |

**93% of every database request was the product listing**, 4 hours of CPU over 5.6 days. And the shape of
the arguments is the diagnosis: combinations like goal+brand+category+tag, in proportions no human
clicking around produces.

The filter panel renders a link per facet value, each one *the current filters plus one more*. So the
reachable set is the product of every facet — 16 categories × 20 brands × 9 goals × tags × sorts × pages —
and `/shop` is deliberately dynamic, because "the filter combinations are unbounded". Every node in that
graph is a live query that no cache can ever serve twice, and something was walking it.

The page already had the canonical tag pointing every filtered view back at `/shop`. **It does nothing for
this.** A canonical deduplicates in the *index*, after the crawler has fetched the URL — and the fetch is
the entire cost.

Three layers, because only the first is free:

- `rel="nofollow"` on every facet link. This is the one that stops the walk.
- `robots.txt` disallows the parameterised listings, for crawlers that ignore `nofollow`.
- `noindex` on any `/shop` with a search param, to drop what is already indexed. Keyed on *any* param
  rather than a list of names, so a facet added later is covered without anybody remembering.

Two things worth carrying forward:

- **Measure before hypothesising.** The obvious suspects — a query in a `map`, a `useEffect` without deps,
  a polling interval — were all absent; the client is clean and the batched helpers batch correctly.
  `pg_stat_statements` named the culprit in about a minute, and the *argument shapes* pointed at the
  caller more precisely than reading code would have.
- **"Dynamic because the inputs are unbounded" and "crawlable" cannot both be true.** Either bound the
  inputs or stop advertising them. This page had the first half of that reasoning written in a comment
  since M3 and never drew the second half.

### Y15 · `backdrop-filter` on the header made every overlay inside it 64 pixels tall

Reported from a phone: the hamburger menu "gets hidden behind the page and does not show the content".
It reads exactly like a z-index bug. It is not one.

```
panel box: { x: 0, y: 0, width: 390, height: 64 }
viewport : 390 x 844
header   : { backdropFilter: "blur(8px)", position: "sticky", zIndex: "40" }
```

The panel is `fixed inset-0 z-50`, which should be the viewport. It came out **exactly the header's
height**, because **`backdrop-filter` makes an element a containing block for `position: fixed`
descendants** — the same rule `transform`, `filter`, `perspective`, `will-change` and `contain: paint`
follow. `inset-0` resolved against the header's box, so the menu opened as a 64-pixel strip with the page
showing through beneath it. The search overlay, mounted in the same header, had the identical defect and
nobody had reported it yet.

Fixed by deleting `backdrop-blur-sm`. At `bg-cream/95` the backdrop is 95% opaque, so the blur was
very nearly invisible, and docs/04 §6 asks for "cream, hairline bottom border, sticky" — not frosted
glass. A portal to `document.body` would also have worked and would have kept the effect; **removing the
trap beat working around it**, because the next overlay added to this header would have hit it again.

Two things worth carrying:

- **When a fixed overlay is the wrong size, suspect the containing block before the stacking order.**
  z-index cannot make an element larger than its containing block, so "hidden behind the page" and
  "clipped to a strip" are the same symptom seen from different angles. Measuring `boundingBox()` against
  the viewport separates them in one step; staring at z-index values never will.
- **Assert the cause, not just the effect.** `e2e/shell.spec.ts` now checks the panel's geometry *and*
  reads the header's computed style for every property that establishes a containing block, naming the
  offender if one returns. The second test is what makes the failure legible to whoever adds a
  `transform` here in a year.

---

## Z. What rebuilding search taught us

The search audit found nine gaps. Fixing them turned up five things worth recording, three of which were
only visible by measuring against the live catalogue rather than by reading the SQL.

### Z1 · The audit was wrong twice, and reading the whole function is what corrected it

Two findings in the written audit did not survive contact with the source. Out-of-stock **was** already
demoted — `f.in_stock desc` is the first `order by` key — and `p_limit` **was** already capped at 100.
Both had been asserted from fragments quoted earlier in conversation rather than from the file.

The habit that catches this is cheap: before writing a finding about a function, open the function. The
cost of skipping it is a remediation plan with two items that were never broken, which is how trust in the
other seven gets spent.

### Z2 · `word_similarity` borrows trigrams across word boundaries

Replacing whole-string `similarity` with `word_similarity` was right — the old comparison scored
`similarity('Magnesium Bisglycinate 400mg 120 Capsules', 'magnesium') ≈ 0.22`, barely over the 0.2
threshold for a perfect single-word match on a long supplement name.

But searching **"magnesium"** then ranked a calcium-and-magnesium blend above two pure magnesium products:

```
word_similarity('magnesium', 'solgar kalcium magnez plus d3') = 0.700
word_similarity('magnesium', 'solgar magnez bisglicinat')     = 0.500
```

`word_similarity` lets the matching extent begin and end anywhere, **including mid-word**. "magnesium"
wants `mag agn gne nes esi siu ium`; "magnez" supplies the first four and the extent reaches back into
**kalciUM** for the `ium`. The blend won on a coincidence in the tail of an unrelated word.

`strict_word_similarity` requires word-boundary alignment and removes it — both score 0.417, a tie, which
is the honest answer since neither name contains "magnesium". Genuine matches are untouched (1.000 for
"vitamina c" against "Solgar Vitamina C 1000 mg") and noise falls (0.091 → 0.053).

**The rejected fix is the more useful record.** Adding whole-string `similarity` back as a "focus"
tiebreak — short single-subject names being more *about* the query — made it worse, and for the same
reason: `similarity('magnesium', 'solgar kalcium magnez plus d3') = 0.212` against `0.161` for the pure
product. `kalcium` contaminates both measures; two readings of the same error do not cancel.

The tie now falls through to rating, featured, and then to the merchandising rules and the query report —
which is the correct place for it. Distinguishing "primarily magnesium" from "contains magnesium" needs
ingredient-primacy data the schema does not model, and inventing a weight for it against zero traffic is
exactly the unfalsifiable tuning the logging exists to replace.

### Z3 · pg_trgm's GUCs do not exist until its module loads

`create function … set pg_trgm.word_similarity_threshold = '0.45'` fails with *unrecognized configuration
parameter* in any session that has not yet touched pg_trgm. The extension being installed is not enough —
the GUCs are registered when the shared library loads, which happens on first use.

Migration 68 carried such a `SET` and applied cleanly, but only because it shared a push, and therefore a
session, with migration 65, which force-loads the module. Migration 70 was pushed alone and failed on the
first attempt for precisely this reason. Both now carry their own:

```sql
do $trgm$ begin perform extensions.show_trgm('biocode'); end $trgm$;
```

The general shape: a migration that depends on session state established by an earlier migration is
correct only under `db reset`, and `db push` is free to disprove it later.

### Z4 · `unaccent` is STABLE, which is why half the matcher ignored accents

The FTS path folded ë and ç on both sides; the trigram fallback compared raw text, and the trigram indexes
were built on raw text too. So the two halves of the matcher disagreed about diacritics — on a market
whose phone keyboards mostly omit them.

The cause is that `unaccent(text)` is declared STABLE (it resolves its dictionary through `search_path`),
and a STABLE function cannot appear in an index expression. The fix is the standard wrapper around the
two-argument form, where the dictionary is explicit and the `::regdictionary` cast on a literal folds to an
OID at parse time:

```sql
create function public.immutable_unaccent(p_text text) returns text
language sql immutable strict parallel safe
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, p_text) $$;
```

Index and query must then use the *same* expression — `search_normalize(name->>'sq')` in both — or the
index is silently unused, and the only symptom is a sequential scan nobody notices until the catalogue is
large enough to hurt.

### Z5 · A comment claimed a behaviour the code never had

`searchIngredients` selected `other_names`, carried a docstring saying it matched "the synonyms in
`other_names`", and filtered on `name->>sq`, `name->>en` and `slug` only. It had never searched the
aliases. So "acid askorbik" did not find ascorbic acid, "vaj peshku" did not find omega-3 and
"kolekalciferol" did not find vitamin D3 — with every one of those aliases sitting in the row that should
have matched.

Selecting a column is not evidence that it is used. Where a docstring makes a behavioural claim, the
cheapest guard is a test that fails when the claim stops being true.

### Z6 · Measured outcome

Recall against the live catalogue — old matcher and old document versus new:

| query | before | after |
| --- | --- | --- |
| `acid askorbik` | 0 | 6 |
| `hirre` (whey) | 0 | 5 |
| `energji` | 0 | 21 |
| `vaj peshku` | 1 | 5 |
| `gjume` | 1 | 5 |
| `sleep` | 1 | 5 |
| `kolagjen` | 3 | 4 |
| `magnez` | 4 | 7 |
| `proteina` | 6 | 11 |
| `kapsula` | 12 | 24 |

The three zeroes are the point. Each was a shopper describing what they wanted in the ordinary word for
it, and being told the shop did not sell it.

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

---

## AA. The mobile hero dot, and what it actually was

Three defects were reported from a phone. One of them was two symptoms of a single cause, one was
already correct, and one did not reproduce. Recorded because the diagnosis matters more than the fix.

1. **"The dot overlaps the buttons" and "the primary button has one squared corner" were the same
   bug.** The dot strip was `absolute … bottom-3` at every width. On a phone the slide is short enough
   that it landed *on* the CTA row, and because the active dot is `forest-800` — the same token as the
   primary button's background — it did not read as a dot on a button. It read as the button having a
   squared-off bottom-right corner. Both buttons already computed `border-radius: 12px` on all four
   corners, measured; there was never a radius bug. Fixed by putting the dots in normal flow under
   `sm` and keeping the overlay from `sm` up, where the two-column layout leaves dead space below the
   copy. Not by z-index: stacking only decides which of the two sits on top, and a decorative dot has
   no business over a tap target either way.
2. **"No padding" was already false.** The buttons computed `12px 28px`. No change.
3. **Unequal width was real.** Side by side at 390 px each button got ~168 px, which is not enough for
   "Krijo Protokollin BioHack" — it wrapped to three lines and the two boxes then differed by the pixel
   the flex gap could not divide evenly. A label that wraps to three lines is the signal that the row
   is the wrong container. Stacked and full width under `sm`: one line each, identical by construction.
4. **"The headline is too large" did not reproduce.** Lines cleared the right edge by 105/141/156/196 px
   at 320/375/390/430, and the hero's left padding (20 px) already matched the trust strip's. Reported
   rather than shrunk — there was nothing to fix.

### The bill for fixing it

Stacking the CTAs cost 14 px of height and moving the dots into flow cost 24 px. Production had
**17 px** of headroom at 390 × 844, so the fix pushed the trust strip off the first viewport — the
regression `e2e/hero.spec.ts` exists to catch, and it caught it. Repaid with a one-step trim on each
mobile gap (`py-4→py-3`, `gap-6→gap-4`, headline/subhead `mt-3→mt-2`, CTA `mt-6→mt-4`, dots `mt-4→mt-2`),
each restoring at `sm`. Net result is 2 px *better* than production at every mobile width.

`no carousel dot sits on a hero CTA` asserts the two rectangles do not intersect, and was verified to
fail under the old positioning before being trusted.

### Still open, and pre-existing

- **640–1023 px keeps the overlap.** The brief scoped the change to below `sm` and required tablet to
  stay pixel-identical, which it is. But the absolute dots still land on the CTA row at those widths
  for the same reason they did on a phone — the layout only goes two-column at `lg`. Moving the
  breakpoint from `sm:` to `lg:` fixes it in one token when the tablet freeze lifts.
- **Short viewports (≤ 375 × 812) put the trust strip below the fold.** True in production too, now by
  2 px less. The header is 109 px and the strip is 116 px; the remedy is a shorter mobile strip, not
  more hero trimming.
- **19 px of horizontal overflow at 320 px** comes from the footer newsletter block (`max-w-xs`),
  byte-identical in production and unrelated to the hero.

---

## AB. The announcement bar's pill was the link all along

The bar rendered `[message] [code pill] [hardcoded "Shop now"] [X]`, where the link text came from
`home.announcement.cta`. The live row was the whole bug in one line:

```
cta_href = /merchant/apply   code = "BioPartner"   → rendered "Bli tani"
```

The author had already written the right words — into a column nothing displayed — while the only
visible link said "Shop now" and pointed at a merchant-onboarding form. The pill and the link were
never two things.

`code` became `link_label` by `alter table banners rename column`, not add-copy-drop: a catalog-only
operation, atomic and instant, with no window in which the value exists in one place and not the
other. Nothing else referenced it — no view, no RPC, no policy, and `seed.sql` never set it. Verified
by reading the row back: `link_label = "BioPartner"`.

### The four shapes, and why they left the component

Which of the two author fields are filled decides what renders, and deciding it inside an `async`
server component made the matrix untestable — proving the label-only case would have meant writing to
the `banners` row that is live on screen. `announcement-parts.ts` takes the row and the locale and
returns the decision as a plain object, so the cases are Vitest assertions instead:

| label | link | renders |
| --- | --- | --- |
| ✓ | ✓ | clickable pill; message stays plain |
| ✓ | — | pill as plain text, no hover |
| — | ✓ | the message itself is the link |
| — | — | message only, no pill |

Whitespace counts as absent in both fields. A pill is never an empty outline — an outlined box with
nothing in it looks like a design rather than the bug it is. And the two branches are exclusive by
construction: with both fields filled the pill takes the link, because a second anchor on the message
would announce the same destination twice to a screen reader and cost a keyboard user a tab stop.

### 44 px on a 22 px pill

Growing the pill to meet the tap-target floor would make the bar taller on every device to fix a
problem that only exists on a touchscreen. A `before:h-11` pseudo-element centred on the pill claims
the height without occupying any — it is positioned, so it contributes nothing to layout, and the
row's existing `min-h-11` already has the room for it. Measured 44 px at 320/375/390 against a 22 px
pill.

`focus-visible` is spelled out on the pill rather than left to the global rule in `globals.css`, whose
outer halo layer is tuned for a cream page and disappears on forest-900. It paints a 2 px lime-400
outline at 2 px offset, with the global box-shadow suppressed.

### Not localised, and deliberately so

`link_label` is plain `text`, not the `jsonb {sq, en}` that convention 3 requires of content fields.
It was exempt as a discount code, which is locale-neutral; as prose it is not, and an Albanian visitor
sees whatever the author typed. Kept as-is because the brief scoped the change to the display label and
help text, and `banners.cta_label` already exists as unused jsonb on this placement — the upgrade path
is to read that instead, copying `link_label` into both locales.

---

## AC. The day the shop paused itself

On 8 Aug 2026 every route began returning `503 DEPLOYMENT_PAUSED`. Not a deploy, not a regression —
Vercel spend management had hit its limit. The day's bill was **$7.02** on a shop with no customers:

| line | | |
| --- | --- | --- |
| Fluid Active CPU | $2.44 | 35 % |
| Fast Origin Transfer | $1.74 | 25 % |
| ISR Writes | $0.97 | 14 % |
| Function Invocations | $0.82 | 12 % |
| Build CPU Minutes | $0.48 | 7 % |
| Fluid Provisioned Memory | $0.46 | 7 % |

The first four are $5.97 of it and they are not four problems. They are four meters on one event: a
page being generated on the server. ISR Writes is the only line named after it, and reading the bill
by largest line would have sent you to "CPU" and told you nothing.

### What was actually generating them

1. **`revalidate = 300` on ~140 routes.** Every content page regenerated every five minutes for as
   long as anything kept asking. Tag-based revalidation already purges correctly on every mutation —
   17 `revalidateTag` call sites — so the timer was never the mechanism, only a backstop against
   edits made outside the app. Five minutes was two orders of magnitude too eager for that job.
2. **A session refresh on every request.** `refreshSession` built an SSR client and called
   `getUser()` — a network round-trip to the auth server — for every page view the matcher admitted,
   including every anonymous crawler fetch, where the only possible answer was `null`.
3. **Crawlers, with nothing worth crawling.** `robots.txt` allowed everything and the sitemap
   advertised all 63 products, 48 of which show a placeholder instead of a photograph.

Not the cause, despite being the obvious suspects: image optimization was already tuned (WebP only,
one-year `minimumCacheTTL`, trimmed size lists — AVIF had been removed earlier for doubling billed
transformations), and the crons are four invocations a day. The listing query was already inside a
tagged `unstable_cache`, so `/shop` was not re-querying the database on every hit — it was
re-*rendering*, which is a different meter.

### The fixes

- **Tiered TTLs.** `STATIC_REVALIDATE_SECONDS = 86_400` for the thirteen pages with no price and no
  stock on them; `ISR_REVALIDATE_SECONDS` 300 → 3600 for the three that have both. Segment config
  must be a literal, so the constants document the intent and the pages carry the number.
- **`SEO_INDEXING`, defaulting to `off`.** `robots.txt` returns `Disallow: /` and every response
  carries `X-Robots-Tag: noindex, nofollow` until it is explicitly switched on. Fail-closed is the
  unusual choice and the deliberate one: a fail-open default means one unset variable in one
  environment quietly restores the bill, whereas the cost of forgetting the switch is a day
  unindexed. It is now a launch-day step in docs/14 §20.
- **Short-circuit the session refresh** when the request carries no `sb-*-auth-token` cookie. Not a
  weaker guarantee — with no cookie `getUser()` returns `null` too, so `/admin`, `needsSession` and
  RLS all reach the same decision by the same route. Anonymous TTFB measured 4–20 ms afterwards.

### The one that got away

An order depletes stock **without purging `CACHE_TAGS.products`** — checkout calls
`revalidatePath('/', 'layout')`, which does not clear a tagged `unstable_cache` entry. So `in_stock`
on a listing is only ever as fresh as the catalogue timer, which is why the catalogue got one hour
rather than one day and why the split exists at all. The real fix is purging the affected
`product:slug` tags when an order is placed; then both tiers can be a day and this note can go.

### What this cost to learn

Some of the 8 Aug spend was this session's own automation — Playwright loads with `networkidle`,
deploy-polling every fifteen seconds, a twenty-route curl sweep. A burst rather than a baseline, but
it landed on the day the limit was reached. Verification against the live site is not free, and on a
metered origin it belongs against a local server unless the live one is the thing being tested.

---

## AD. A category in two kinds of URL

Reported as "the × on the active-filter chip does not clear the filter". Three hrefs from one page
are the whole diagnosis:

```
on /shop/vitaminat?brand=now-foods
  "Vitaminat"   -> /shop/vitaminat?brand=now-foods    ← identical to the current URL
  "NOW Foods"   -> /shop/vitaminat?category=vitaminat ← the category, now in the query too
  "Hiq filtrat" -> /shop/vitaminat                    ← clears the brand, keeps the category
```

`/shop/[category]` scopes the listing by **path** and expresses that by injecting the slug into the
filters object — `{ ...parseFilters(searchParams), category: [slug] }` — with `basePath` set to
`/shop/<slug>`. `buildQuery` serialises filters into a **query string** and returns only the `?…`
part; it cannot rewrite a path. One mismatch, three symptoms: removing the category edited a value
that was never in the query and produced the URL it was already on; removing anything else
re-serialised the injected category into the query; and clear-all pointed at the scoped path.

Fixed at the mismatch rather than at the chip. `unscopeCategory(filters, scopedCategory)` yields the
filters that may legitimately become query state, every link on a scoped page is built from those,
and the scoped category is removed by navigating to `SHOP_PATH` — the one move that reaches the path.
`filters` still drives the database query, because the category is a real filter.

### What the report got wrong, and why it was reasonable

It said the failure hit every filter type on desktop and mobile. It does not: on `/shop?brand=…` and
`/shop?category=…` removal always worked. Only the category page was broken.

Worth recording because **my own first reproduction agreed with the report** — it showed the sidebar
links and the brand chip failing too. That was a measurement artifact: a soft navigation fires no
load event, so `waitForLoadState('networkidle')` returned before the transition finished and every
assertion sampled the old DOM. Re-running with an explicit wait for `location.href` to change left
exactly one failure standing. A reproduction that confirms the reported scope too neatly deserves a
second look before it becomes the diagnosis.

`tests/unit/filter-scoping.test.ts` pins the hrefs as strings, because every one of them looked
plausible alone — the bug was only visible when the chip's href was placed next to the current URL.

### Found while verifying

`catalog.spec.ts` still asserted a "Shop by goal" heading on the home page. The goals grid became the
intent band, whose heading is `sr-only` "Where to start", so the test had been failing since that
change and nobody had run it. It now asserts the tile link a visitor actually clicks, which is a
stronger thing to pin than a hidden string.

---

## AE. Two steps for one intention, and a picker that hid the catalogue

Two reports from the merchant portal, one session. They turned out to be four faults.

### The offer picker showed 20 of 72, and could not search

`searchCatalogVariants` capped at 20 rows ordered by `sku`. Measured on production: **72 live variants
across 15 brands**, of which the unsearched page reached 20 variants across **6** — BIOCODE,
BioTechUSA, Garden of Life, Jamieson, Lamberts, MyProtein. Every brand whose SKU sorts later, NOW Foods
and Optimum Nutrition among them, was unreachable.

The search could not recover them, because it searched the wrong column:

```ts
.or('sku.ilike.X,name->>sq.ilike.X,name->>en.ilike.X')   // against product_variants
```

A bare column inside a PostgREST `.or()` binds to the **queried table**, so `name` was the variant's
size label — "750 ml e zezë", "60 kapsula" — never the product title. `product_variants.name` is jsonb,
so it did not error; it matched nothing. Measured: `whey` matched **0** variant names and **8** product
names.

No argument to `.or()` fixes it — PostgREST cannot OR a parent column together with an embedded
resource — so the product title has to *be* a column. `v_catalogue_variant_search` (migration 78)
flattens the join with one prebuilt lowercase haystack over brand, product name, variant name, SKU and
barcode. `security_invoker`, so RLS still applies and deactivating a brand still withdraws its variants
from every picker — the owner's supply lever, now depended on deliberately.

After: 72 variants, 15 brands, whey 0→8, solgar 0→5, magnez 0→3.

### Approval created a product and stopped

A proposal already carried stock and an asking price. Approval created a draft product, and the merchant
then had to find it in the picker and re-type stock, price, SKU and handling days it had already stated.
For a 200-row batch that is 200 forms after the approval.

The proposal now carries all five offer terms and approval mints the offer (migration 79). The owner's
decision is that it is **live the moment compliance publishes** — defensible because the reviewer
approving the proposal has just read those exact terms.

### The invariant that made it safe was not written down

An offer minted this way is `approved` against a product that is still `draft`. That was safe only
because no caller happened to pass a draft variant id to `variant_buy_box` — a property of today's call
sites, not a guarantee, and this change is precisely the one that starts creating such offers. The
function is `security definer`, so it is the one place RLS is not doing the work; it now requires the
product to be published itself.

Proven in a transaction that rolled back: an `approved` offer on a draft product exists
(`offers_on_variant = 1`) and `variant_buy_box` returns `source = none`.

### Separate queues, because they fail differently

`create_offer_from_proposal` is its own RPC, not part of `promote_proposal_to_draft`. Promotion copies
every photograph between buckets — many round trips, not transactional. Minting is one INSERT behind two
CHECKs. Fused, a malformed asking price would roll back a product that was fine, return the row to
`proposals_awaiting_promotion` with `created_product_id is null`, and — because the housekeeping cron
turns a push failure into an HTTP 500 — leave one poison row failing every night while holding a slot at
the head of a `limit(15)` queue.

Idempotency is keyed on `offer_created_at`, never on `created_offer_id`: the FK is
`on delete set null`, so keying on the id would have the nightly sweep recreate an offer the merchant
deliberately deleted. `offer_attempts` caps retry at three and `offer_error` records why, so a row whose
terms can never satisfy the CHECKs goes quiet instead of failing loudly forever. The cron deliberately
does **not** push offer failures onto `failures` for the same reason.

`approved_by` stays NULL. The only candidate is `auth.uid()`, which is NULL when the cron calls as the
service role — so half the offers from one decision would name an approver and half would not.

### Caught while verifying: three tests asserting the old robots.txt

`checkout.spec.ts` and two in `compliance.spec.ts` asserted per-path `Disallow` lines and a `Sitemap:`
line. The pre-launch crawl block (§AC) makes robots.txt `Disallow: /`, which covers those paths *more*
strictly — so the suite was reporting a stronger robots.txt as a regression. I shipped §AC without
running these, which is the actual mistake. The money-path test now accepts either shape; the two that
describe the indexable configuration skip while the block is on, rather than being weakened into
assertions that pass either way.

---

## AF. The merchant bulk upload, assessed and rebuilt

Reported as "not user-friendly for merchants who keep simple Excels and are not familiar with CSV".
Investigating it found a money bug underneath the usability one.

### The money bug

`parsePrice` chose the decimal separator from the **field** separator. Measured on the real parser:

```
sku,stok,cmimi / A,12,"9,90"  ->  99000 cents  ->  EUR 990.00   malformed: []
sku,stok,cmimi / A,12,9,90    ->    900 cents  ->  EUR   9.00   malformed: []
sku;stok;cmimi / A;12;9,90    ->    990 cents  ->  EUR   9.90   correct
```

A hundred times too high under a green "1 row applied". Internally coherent — with a comma between
fields a comma cannot be a decimal — and exactly inverted for a market where the comma **is** the
decimal. `merchant.bulk.pasteHint` promised the unsafe form was fine, and `merchant-csv.test.ts:80`
pinned the 100× reading as correct, so the suite endorsed it. Google Sheets exports comma-delimited and
an Albanian-locale sheet writes and quotes `"9,90"`, so the path is real rather than theoretical.

The separator is now read from the **shape of the number**: both present, the last is the decimal, so
`1.250,00` and `1,250.00` are both 1250.00; one present, it is a decimal unless followed by exactly three
digits, where `1250` and `1.25` are equally plausible and it is **refused by name** rather than guessed.
Refusing is the point — the one thing worse than rejecting a row is applying the wrong money to it.

`proposal-csv.ts` carried its own copy of the same bug, in the flow that mints the offer on approval
(§AE). One implementation now, so it cannot be fixed in one place and left in the other.

### Three more silent paths, closed

- **A row with more cells than the header** was read by index, so a stray separator shifted every column
  after it — and the shifted values were often still valid, which is why it never surfaced. Refused now.
- **Our own export caused it.** `merchant_sku` is free text and was written unquoted, so a merchant whose
  internal code is `ART;114` was handed a file BioCode had corrupted. Every cell is quoted at the source.
- **A price over the int4 ceiling** raised inside the RPC, rolled back all 199 good rows and surfaced as
  "something went wrong" with no line and no cell, reproducing forever on retry. Bounded in the parser.

### The usability work

**There was no way to give it a file.** Both flows were a bare `<textarea>`; the only `type="file"` inputs
in the feature were for images and KYB documents. A merchant with `stok-tetor.xlsx` had to know to Save As
CSV, know which delimiter their Excel locale writes, and know that a comma decimal collides with a comma
delimiter — three pieces of CSV knowledge before changing one stock number.

`/api/merchant/sheet` now takes the file. A **route handler**, not a Server Action, because an action body
is capped at 1 MB and a spreadsheet is not. It reads and returns text; it writes nothing, so the existing
action still performs the update behind the same validation, caps and RLS.

`readSheet` converts to semicolon-delimited text with **every cell quoted** — the one shape the existing
parsers read unambiguously. They keep their 39 and 25 unit cases and gain a format for free, and whole
classes of bug disappear rather than being diagnosed: no delimiter to detect, no BOM, no quoting rules,
and a 13-digit barcode arrives as digits instead of `8.71235E+12`.

The picker fills the textarea rather than replacing it, so the merchant **sees what was read before
saving** and the file path and paste path share every downstream check.

### On the dependency, where the investigation was wrong

Four readers and three designs concluded no package was needed and proposed ~380 lines of hand-rolled ZIP
and OOXML parsing, rejecting SheetJS on the First Load JS budget. `scripts/check-bundle.ts` measures
**client** bundles: a parser used only in a route handler costs nothing against it. `exceljs` is added and
server-only; `check:bundle` confirms `/merchant/proposals/bulk` at 135 kB against a 170 kB budget. Owning
an OOXML reader to save a budget it does not touch would have been a bad trade.

### The reset, for the third time

React 19 empties an uncontrolled form when its action resolves, so the textarea cleared exactly as the
report of row numbers appeared. "Rreshti 47" against text that is gone is unactionable. The hero slide
editor and the announcement bar were the first two; both bulk sheets now hold their contents in state.

### Still open

A preview of current → new per row before writing, a confirmation on large price moves, a template
whose identifier columns are pre-formatted as text, one error list merging parse failures with database
skips by row number, browser-side photo downscaling, and a withdraw path for a batch. Each is listed with
its reasoning in the assessment; none is a correctness risk, and all of them were behind the money bug.

---

## AG. Editing a live price, and a sample workbook that comes back

Two owner decisions on 2026-08-10.

### A price change returns the offer to review

`settings.marketplace.price_change_review` has existed since migration 47, defaulting to `false`, with
the note that turning it on was "a §6 decision". It is on now.

Enforced by a **trigger**, `demote_offer_on_price_change`, not by `updateOffer`. That action is one of
three ways a price moves: `merchant_bulk_upsert_offers` writes `price_cents = coalesce(v_price,
price_cents)` straight onto approved rows, and `merchant_bulk_create_offers` reaches the same column. A
rule in the action would re-review one edited offer and wave through a pasted sheet of two hundred new
prices — the larger hole and the quieter one.

**Stock is exempt, deliberately.** A merchant updating quantities nightly from its own sheet is the
ordinary use of this marketplace; putting every offer into review each evening would make the queue
useless and the portal hostile. `handling_days` is a customer-facing promise and arguably belongs with
price; left out until asked.

Proven in a rolled-back transaction: `after_stock=approved after_price=pending_review
after_draft=draft` — stock stays live, price demotes, and an offer that was never approved is not
promoted into review by editing it.

`merchant_offers_write_guard` raises `OFFER_APPROVAL_FORBIDDEN` if a merchant's statement changes
`approved_at`, and BEFORE triggers fire in **name order**. So the new trigger sets `status` only and is
named `merchant_offers_zz_price_review` to sort after the guard. Setting only `status` means the order
does not actually matter — which is the point, and is written down because a future edit that touches
the approval columns would silently depend on it.

**What it costs the merchant.** `variant_buy_box` requires `approved`, so correcting a typo takes the
product off the shelf until a reviewer looks. That is what was asked for, and the form now says so
before saving rather than after. The better design — keep selling at the approved price while the new
one waits, via a second price column the buy box ignores — is a larger change and is not built.

### A sample `.xlsx`, not a CSV

The offers page handed out a CSV, and the CSV was the source of most of its trouble: it cannot carry a
column type, so Excel re-guesses every cell on open. A 13-digit barcode becomes `8.71235E+12`, `MAR-3`
becomes `03-Mar`, and a comma decimal collides with the comma that separates the fields — arriving later
as "we do not list that product", or, until migration 78, as a price a hundred times too high.

`numFmt: '@'` on the identifier columns fixes it **at source**: Excel leaves the barcode alone the moment
the file opens. Prevention, where this codebase had been accumulating diagnosis.

What makes it usable by somebody in a hurry, rather than merely correct:

- **The offers sheet arrives filled with the merchant's own SKUs, stock and prices**, so a stock update
  is typing over numbers instead of building a spreadsheet. Every status is included — omitting a paused
  offer reads as BioCode having lost it, and re-adding it by hand is how a duplicate row appears.
- **One greyed, italic example row** on the proposals sheet. Deleting it is obvious; inferring a format
  from a header is not.
- **A frozen header and real column widths**, because somebody scrolling 200 rows should not lose track
  of which column is the price.
- **A second sheet of instructions in Albanian**, so the rules travel with the file rather than living
  on a page the merchant closed.

The header names are the ones the parsers already accept, so it round-trips: download, edit, upload,
nothing renamed in between. `tests/unit/sheet-template.test.ts` asserts exactly that — build the
workbook, read it as if uploaded, run it through the parser that decides what gets written. The
catalogue CSV failed this test before it existed: it carried identifiers only, so pasting it back
returned `no_header` and told the merchant to add a header row while they were looking at one.

The CSV download stays, demoted to a plain link, for anyone whose tooling wants it.

---

## AH. The cache tiers were dead from the day they were written

The 8 Aug cost work (§AC) gave the storefront two tiers: a day for pages with no price or stock, an hour
for the catalogue. It was reported as shipped. It never took effect. From `.next/prerender-manifest.json`:

```
before:  60s : 40 routes      after:  300s :  2 routes
       3600s :  6                   3600s : 44
      86400s :  1                  86400s :  1
worst-case rebuilds/day: 57,745            1,633
```

**A route's cache life is the shortest cache used while rendering it.** `getAnnouncement()` carried
`revalidate: 60` and is awaited in the shared storefront layout, so sixty seconds became the cache life of
every page that renders through it — legal pages included, whatever their own `export const revalidate`
said. Nothing in `legal/terms/page.tsx` hints that another file decides its number.

That is why ISR Writes **rose** from $0.97 to $2.18 a day across a change intended to cut them. I reported
the fix without reading the build output, and it cost two days of the wrong number.

### Why the 60 seconds was there, and what replaced it

The query filtered `starts_at <= now()` and `ends_at > now()`, which makes its result true only for the
instant it ran — so the cache around it had to be short. The window now travels to the browser and the
bar's existing pre-paint script applies it against the visitor's own clock. The page cache is decoupled
from time entirely: HTML can be a day old and the bar still vanishes the minute the campaign ends.

Honest cost: with JavaScript off, an expired bar stays visible. A late banner for a scripting-disabled
visitor, against every page on the site rebuilding every minute.

Two reads are genuinely time-dependent and were traded rather than fixed. `listHeroSlides` is filtered by
RLS (`starts_at <= now()`) and `list_live_placements` bills an advertiser by the day; both went 60s → 300s.
Publishing by hand stays instant either way, because the admin purges the tag on save — the timer governs
only a start or stop nobody triggered. `getSearchPlaceholders` runs in the navbar and had no clock
dependency at all; it went to the long tier.

### The guard

`tests/unit/build-cache-budget.test.ts` reads the compiled manifest and fails if any route rebuilds faster
than its tier, with a blunt assertion that **nothing** may sit at 60 seconds. It asserts against the
artefact Vercel bills from, because no test over the source could have caught this and neither could a
reviewer. Verified to fail against the pre-fix build before being trusted.

It asserts the hour floor, not the day: something still caps the legal pages at 3600 and I have not found
it. A guard should pin what is true.

### A scare that was not real

The prerendered route count appeared to fall from 186 to 52. Building the previous commit and diffing the
two manifests showed **52 both sides, nothing lost or gained** — the 186 came from an unrelated earlier
build. Worth recording because the correct response to an unexplained number is to go and measure it, not
to ship and hope; and because build-to-build variance in `generateStaticParams` (it queries the live
database, and returns an empty list on error) is real and would be invisible.

### Also removed

`runbooks/deploy.md` documented `E2E_BASE_URL=https://biocode.fit pnpm test:e2e` as a post-deploy step.
It works, which is the problem: it drives a real browser through the live shop, places and cancels real
orders, and leaves fixture products in the catalogue for the twenty-five minutes it runs. CI already runs
the same suite against a local database on every push, so the production run adds no coverage.

---

## AI. "Show all 12" was a button that never admitted being pressed

Reported from the shop with all twelve categories on screen beneath a control still offering to show them.
The list was open; the label had not moved. A control that does not acknowledge being pressed is
indistinguishable from one that did nothing.

Four faults, all shared by both hand-rolled copies — which is what made this a primitive rather than a fix:

1. **The label never changed.** `<summary>{t('shop.showAll', { count })}</summary>` rendered the same
   string open or closed. There was no "show fewer" string in the app at all.
2. **The number was the total, not what was hidden.** Six of twelve were already visible, so "show all 12"
   asked the reader to subtract to discover that six more existed.
3. **The toggle sat between item six and item seven.** The `<details>` carried its own `<ul>`, so the
   markup was list / control / list and the control read as an option in the middle of the group — in the
   screenshot it looks like a category named "Show all 12".
4. **A collapsed group gave no hint that a filter inside it was active.** It force-opened, which is right,
   but nothing counted the selection.

And a fifth that only shows up across files: **categories and brands each had their own copy, while goals
and dietary tags had no shortening at all.** Two implementations of one idea and two groups that missed it.

`components/ui/collapsible-list.tsx` is now the single implementation, applied to all four groups.

### The label is fixed in CSS, not in state

Both labels are rendered and `details[open]` picks one:

```
details[open] .[details[open]_&]:hidden { display: none }
details[open] .[details[open]_&]:inline { display: inline }
```

Verified in the emitted stylesheet, because a Tailwind arbitrary variant containing nested brackets is
exactly the kind of thing that silently fails to compile — and had it dropped, the fix would have shipped
looking identical to the bug. Then verified in a browser:

| state | label |
| --- | --- |
| collapsed | "Show 6 more" / "Show 10 more" — the hidden count |
| clicked open | "Show fewer" |
| hidden brand active | forced open, label "Show fewer" |

No JavaScript, so it behaves the same in the desktop sidebar and the mobile sheet, and it is correct in the
first paint rather than after hydration.

### Known and deliberate

**Expansion does not survive a click.** Every option is a link, so the server re-renders and `open` is
recomputed from whether a hidden option is active — expand to browse, pick a *visible* option, and the
group closes. Fixing it needs either a URL parameter, which `robots.ts` exists to keep out of URLs, or
client state that survives a soft navigation, which a server-rendered panel cannot hold. Recorded rather
than left to be rediscovered.

---

## AJ. The category row, designed from the assets that exist

Six pale rectangles with a name in each. Interchangeable, and silent about everything a shopper wants to
know before clicking: what is inside, how much of it, what it looks like. One of the six — `equipments`,
rendered as "BioGear" — had **zero published products**, so a tile that looked like a destination was a
dead end.

### What the data allowed

Checked before drawing anything, and it decided the design:

| | |
| --- | --- |
| `categories.image_path` | null on every row |
| `categories.icon` | set on exactly one of twelve |
| product photography | 45 of 63 published products |
| product counts | 8, 7, 5, 5, 5, 5, 4 … and one zero |

So any layout leaning on category artwork would have rendered *worse* than the rectangles, because the
fallback would have been most of the row. What exists is product photography, so each tile shows the
best-rated photographed product in its category. That is the better idea regardless: a category picture
is a stock photo of an abstraction, while a real product from the shelf is a promise about what is behind
the click — and it updates itself as the catalogue does.

The count does what a picture cannot. "8 products" says the shelf has depth, and is honest when it does
not. Ordering by count means the row leads with the deepest category rather than with whatever
`sort_order` happened to say, and the empty one is gone.

### A view, after the embed failed silently

The first version expressed this as a two-level PostgREST embed with filters on the inner resource and a
pick-the-best-one per group. It returned an empty array, the component returned `null`, and the section
**vanished from the homepage with no error**. `v_category_tiles` (migration 82) says it once in SQL with
`distinct on`, can be tested on its own — it was, before being wired — and leaves the storefront read an
ordinary select.

`order by (storage_path is null), rating_avg desc` is the whole trick: the best-rated product *that has a
photograph* wins, so a five-star unphotographed product cannot leave a tile blank. The image join is
`left`, so a category with products but no photography still appears with its count and a tinted panel.

### Three things caught only by looking at it

- **Wrong bucket.** `storageUrl('products', …)` — it is `product-images`. Every tile rendered a broken-image
  icon. Confirmed fixed by asserting `naturalWidth > 0` on all six rather than by eye.
- **White squares in green tiles.** Supplement packshots are cut out on white, so a tinted image panel made
  every photo look pasted on. White behind a photograph, tint only behind the empty case.
- **A stale data cache.** After the view was correct the section was *still* missing, because
  `unstable_cache` was serving the empty array from the broken query. Second time in two days that a
  `.next/cache` entry outlived the code that produced it.

### Mobile

Six tiles in a two-column grid is three rows of scrolling before the footer. A snapping horizontal rail
shows two and a half — the half is the affordance — for one row of height. Verified: no horizontal
overflow at 390 px.

## AK. Nothing told an admin there was work waiting

Reported by the owner (2026-08-12): a merchant files proposals and the panel says nothing. You have to
open `/admin/merchants/proposals` to discover there is something in it — so the way to learn you have a
queue is to already suspect you have one.

### The numbers, counted before designing anything

| Table | Predicate | Count |
| --- | --- | --- |
| `product_proposals` | `status = 'pending'` | 6 |
| `merchant_offers` | `status = 'pending_review'` | 2 |
| `contact_messages` | `status = 'new'` | **82** |

Ninety items in queues, visible from nowhere. The messages backlog was the largest and the oldest, and
nobody had thought to ask about it — which decided the scope: **all eleven staff queues**, not the two
that prompted the complaint. Badging only the reported ones moves the next invisible backlog to whichever
surface was left out.

The other eight (`merchants`, `merchant_payouts`, `order_fulfilments`, `orders`, `reviews`, `products`
awaiting compliance, `ad_placements`, `referral_links`) were all at zero. They are wired anyway, because a
counter that only appears after someone notices its absence is the bug being fixed.

### Three surfaces, one query

- A count pill on each sidebar and drawer nav item.
- A dot on the mobile hamburger. Below `lg` the nav is a closed drawer, so a badge *inside* it reproduces
  the original defect one breakpoint down — invisible until you already went looking.
- "Needs attention" at the top of the dashboard: one sentence per queue, linking to it already filtered.

`v_admin_pending` returns all eleven as a single row. The admin layout renders on every navigation, so
eleven separate count requests would be eleven round trips per page view. Partial indexes on each queue
predicate: a confirmed order leaves `orders_pending_idx` entirely, so it stays the size of the backlog
rather than the size of the order book.

### Capability filtering is inherited, not re-derived

The obvious design gives each queue a `Capability` and re-checks it. That is a second copy of the
permission matrix and the copy that drifts — a queue disagreeing with its nav item would badge a link the
role cannot see, or hide one it can.

Instead counts are keyed by **route** and decorated onto the already-filtered `visibleNav(role)`. A role
that cannot reach a page has no nav item, so there is nowhere to hang the badge and nothing to check.
`pendingQueues` also takes each row's **label** from the nav item, so the badge and the sidebar cannot name
the same place differently.

### `anon` could read it, despite the grant

Migration 84 granted select to `authenticated, service_role` and named `anon` nowhere. A signed-out probe
read it anyway: Supabase ships `alter default privileges … grant all on tables to anon, authenticated,
service_role`, so naming grantees in a migration adds nothing to what already applies.

It returned eleven zeros — `security_invoker` means RLS on each underlying table applies, and it held. But
"safe because every one of eleven policies is right" is a worse position than unreachable, and one
permissive policy added to `contact_messages` in a year's time would silently turn this into a public
backlog counter. Migration 85 revokes it.

**The general lesson:** in this project a `grant` list in a migration is documentation, not enforcement.
Anything that must not be public needs an explicit `revoke`.

### Two things caught only by running it

- **`import 'server-only'` made the logic untestable.** It throws under Vitest's jsdom environment, so the
  whole module was unimportable from a unit test. Split at that line — `pending-queues.ts` is pure and
  tested, `pending.ts` holds the one `select` that genuinely needs a request context. The better structure
  anyway; the constraint just forced it.
- **A 938 kB screenshot was already in the repo.** `git add -A` in `82a42ff` committed `.shots/live.png`.
  Removed, and `.shots/` is now ignored.

### Verified by rendering it

Signed in as a real admin against the production database: badges 82 / 6 / 2, no badge overflowing the
15 rem rail, hamburger reading "Open admin menu — 90 waiting", and every dashboard deep link carrying only
a status that page's own `STATUSES` array accepts. An unrecognised `?status=` does not error on any of
these pages — it silently falls back to the default tab — so a typo would have produced a link that
landed on the wrong list while looking correct. `tests/unit/admin-pending.test.ts` now asserts that, plus
that every queue resolves to a shipped nav route and that no view column is left unbadged.

## AL. "Check the fields marked below", with nothing marked below

Reported by the owner (2026-08-12): reviewing a product, a validation failure gives a general error **and**
loses everything already typed. Two separate defects behind one experience.

### 1 · The field errors were computed, logged, and thrown away

`saveProductGeneral` ended its failure branch with:

```ts
logger.info('Product save rejected', { issues: parsed.error.flatten().fieldErrors });
return catalogFail('admin.catalog.errors.checkFields');
```

That key's text is *"Check the fields marked below."* — so the copy promised something the code did not
do. `saveVariant` was worse: a bare `catalogFail`, not even logged.

**And `flatten()` could not have marked them anyway.** Probed against this project's Zod (4.4.3) with the
real schema: an empty Albanian name plus an over-long English one returns

```json
{ "name": ["REQUIRED", "Too big: expected string to have <=160 characters"] }
```

One key for two inputs, so neither can be marked — the same trap already recorded for the intent band
(§AI-era work). `issue.path.join('.')` gives `name.sq` and `name.en`, which are the input `name`
attributes verbatim, so the lookup needs no mapping table. Extracted to `lib/field-errors.ts`.

Two things that probe also settled:

- Zod's own wording is written for whoever wrote the schema: `Too big: expected string to have <=160
  characters`, `Invalid option: expected one of "capsule"|"tablet"`, `Invalid UUID`. And this project
  deliberately uses custom messages **as machine codes** (`REQUIRED`, `SLUG_INVALID`), which would put a
  constant name in front of an editor. Hence `CATALOG_FIELD_MESSAGES` plus a code-derived fallback.
- A `.max()` inside `.optional().or(z.literal(''))` still reports a plain `too_big` carrying `maximum`,
  so the union does not obscure the length case. `invalid_union` is unreachable from a form at all —
  every `FormData` value is a string.

A test caught one bug in the fix itself: a `custom` issue from `.refine()` carries prose an author wrote
by hand, and the first version replaced it with "Not valid.". Precedence is now copy map → code-derived
sentence → the issue's own message, with a bare SCREAMING_SNAKE message refused.

### 2 · React 19 empties an uncontrolled form after the action

Success or failure — it does not look at the return value. So a form built from `defaultValue` is wiped
back to the saved record at the moment it reports "check the fields below".

The workaround was already written out by hand in **five** components. Four capture with
`Object.fromEntries(formData.entries())`, which **keeps only the last value per key** — wrong for any form
with repeated field names. Those four have no groups, so it is latent there; the product editor has three
(`dietaryTags`, `categoryIds`, `goalIds`) plus a `primaryCategoryId` radio group, so a sixth copy would
have silently unticked five of six categories on every rejected save. Hence `useFormDraft`, which holds
`string[]` per name.

The subtle rule inside it: an unchecked box submits **nothing**, so an absent key after a real submission
means "deliberately cleared" and must come back cleared. Falling back to the saved value would re-tick
what the editor had just unticked — a more confusing bug than the data loss.

Not every tab needed it. The SEO and Ingredients tabs are fully controlled, so React's reset has nothing
to wipe; the Ingredients table instead submits as one JSON field, which means no input can carry
`aria-invalid` and the row errors are listed **by ingredient name** rather than by row number.

### Why the server-side echo was not extended instead

`CatalogState` already carries `values`, filled by `withValues`. It is unusable for the General tab: it is
built with `Object.fromEntries` (same collapse) and truncates every field to 500 characters, which would
behead an 8000-character description. `product-editor.tsx` never read it anyway.

### Three process failures worth recording

- **A stale dev server, not stale code.** The first verification showed every field lost and no field
  marked — apparently disproving the fix. The server on that port had been started before the edits;
  `pnpm start` could not bind, exited, and the old build kept serving. Third stale-artefact incident this
  week after two `.next/cache` ones. The check is now "grep the built chunk for a string only the new
  code contains" before trusting a result.
- **Interacting before hydration.** The run before that clicked Save while the page was still static, so
  the browser did a native form POST, navigated, and every field came back as the saved record — which
  looks exactly like the bug. Verification now gates on a client-only behaviour (tab switching) first.
- **A fixture admin survived cleanup.** `auth.admin.deleteUser` returned 500 and the script reported it
  but had already finished. Cause: the fixture's successful save wrote an `audit_logs` row, and
  `audit_logs_actor_id_fkey` refuses to let the profile go — correct by design (CLAUDE.md §10). The
  consequence is general: **`e2e/helpers/accounts.ts:deleteCreatedUsers` ignores the delete error**, so any
  fixture that performs an audited action is left behind, able to sign in, including `admin` ones. Fixture
  teardown must demote to `customer` first and fall back to a soft delete. Verification that writes
  nothing avoids the problem entirely, which is what the form check now does.

### Verified by driving the real editor

Signed in as a real admin against a **draft** product, typed a subtitle, a description and a serving size,
ticked all seven dietary tags and two categories, then broke the slug and emptied the required name:

- alert: *"Check the fields marked below. 2 fields need attention — nothing you typed has been lost."*
- `slug` marked *"Lowercase letters, numbers and single hyphens only — like vitamin-d3-4000."*
- `name.sq` marked *"Required."*
- all three typed fields, all seven tags and both categories still there; the bad slug still present to be
  corrected; the emptied name still empty
- the database row untouched, because the check only ever submits an invalid form

## AM. Admin CRUD, audited and then built

The owner asked (2026-08-12) to be able to delete and edit products, brands and so on, and for a thorough
assessment first. The assessment's headline: **the database already designed most of it, and the actions
were never written.** Five tables carry `deleted_at` — `products`, `brands`, `categories`, `articles`,
`profiles` — and the public read policies already exclude it:

```
products:   (status = 'published' and deleted_at is null)
brands:     (is_active and deleted_at is null)
categories: (is_active and deleted_at is null)
articles:   (status = 'published' and deleted_at is null)
```

So a removal takes effect on the storefront, the sitemap and every anonymous read **at the database**. It
cannot be honoured by one query and forgotten by another. Nothing set the column.

Of 88 server actions, 14 could delete anything, and none touched a product, brand, category, ingredient or
goal. Three verifiers confirmed the gap by exhaustive enumeration; the only deletion paths were shell
scripts (`purge:test-data`, `purge:demo`), neither reachable from the panel.

### The rule that came out of it

**What is live must be taken down before it can be removed, and removal must be undoable.** Every entity
already had a reversible way of being taken down — a status, an `is_active`, a rejection — so each refusal
names that step rather than inventing a new one. One rule, seven entities, which is why it reads as a rule
instead of seven opinions.

### Hard delete: proven, not inferred

The design rested on "stock movements block a product delete". That had been read off the migrations and
never executed. Executed:

```
REFUSED — update or delete on table "product_variants" violates foreign key constraint
"stock_movements_variant_id_fkey" on table "stock_movements"
```

24 of 70 products would refuse. A product with no such history deletes and its variants cascade.

**The first attempt at that proof proved nothing** and looked like a disproof: the stock-movement insert
had failed on a wrong column name (`delta`, not `quantity`), so "delete succeeded" was measuring an empty
fixture. Read the setup output before believing the result.

That reshaped hard delete from an alternative into a **second step from the bin**, because it adds exactly
one thing over removal — the slug becomes reusable. It is refused unless the record is provably empty, and
the guard is tight because *succeeding* is the dangerous case: thirteen tables cascade with a product,
including customer reviews and merchant offers, which would go with no audit row of their own.

### Where a soft delete would have been wrong

**Reviews.** `refresh_product_rating` fires `after insert or update of status, rating or delete` and
recomputes from `status = 'approved'`. A DELETE therefore corrects the product's stars automatically; a soft
delete would not fire the trigger at all and would leave a removed five-star review inflating a live
product page. The blunter-looking option is the correct one. `pages`, `faqs` and `banners` have zero inbound
foreign keys, so a delete there cannot orphan anything either.

### Three bugs the audit turned up

- **`rejectProduct` left the approval stamp behind.** It wrote `{ status: 'draft' }` alone, so a product
  compliance had just rejected still reported *Approved* and its checklist read "Everything is in place."
  `guard_product_publish` keys the whole publish gate on that stamp.
- **A comment had a foreign key backwards.** `certification-actions.ts` claimed
  `product_certifications` has no cascade, so "a delete would fail at the foreign key anyway". Migration
  `20260731000300_catalog.sql:195` declares `on delete cascade` — the database would refuse nothing and
  would strip an Organic or Vegan badge from every product carrying it. The in-use check is the whole
  protection.
- **The product editor's Brand and Category dropdowns did not filter `deleted_at`,** so a removed brand
  stayed selectable and choosing it would write a reference every other query hides.

### Two UI defects found only by driving it

- **The bulk bar unmounted its own report.** Rendered under `rows.length > 0`, so removing everything on
  screen destroyed the component holding the confirmation — the most decisive action available gave
  silence and a blank list. Caught by removing four of four.
- **A `form=` attribute resolved to null at rest.** The merchant bulk form only existed once a panel
  opened, so every checkbox was bound to nothing until then. It worked by accident, because the browser
  re-resolves the association before submit.

### The 37 orders

The dashboard read €814 across 37 orders. Every one was a leftover fixture: zero `order_items`, an
`anonymised+…@deleted.invalid` address, no payment rows. `purgeFixtures` had anonymised the customers but
its order patterns (`%@biocode.test`, `SH-9999-%`) never matched these, so the rows survived.

CLAUDE.md §10 forbids hard-deleting orders, and that rule protects real commercial history. Each row was
checked individually against all three conditions rather than trusted as a group, exported to JSON first,
and then deleted — 37 of 37 qualified. The dashboard now reads 0 orders and €0.00, which is the truth.

### Retention

A bin nobody empties is a second catalogue, and every slug in it is an address that can never be reused.
So the housekeeping cron gained a tenth step: records removed more than **90 days** ago and still provably
empty are destroyed, bounded to 20 a run. It uses the same guard as the manual path, so the cron cannot be
a back door around a refusal — anything still attached is counted as `kept`, indefinitely, which is the
correct outcome for a product whose history outweighs its slug.

## AN. The catalogue in Excel, and the diff nobody made

Reported at `/admin/products` as: *"i need to be able to download an excel file with all the fields. then i
can fill those fields in excel file and upload it back to reflect the changes i added in the file. this is
much more convinient than filling each one by one"* — which is correct, and was correct for merchants two
milestones earlier (§ the merchant sheet). 71 products edited one form at a time is the wrong shape for a
price round or a translation pass.

### The one bug that would have killed the feature

An untouched download, uploaded straight back, reported **78 price changes**. Not a crash — worse. A diff
full of changes nobody made is a diff nobody reads, and an operator who learns to click past the report has
lost the only protection the feature has.

The cause was three conversions that each looked lossless:

| step | value |
| ---- | ----- |
| `fromCents(1090)` writes | `"10.90"` |
| Excel stores the number | `10.9` |
| the reader returns | `"10.9"` |
| compared as text | **changed** |

Fixed by comparing **amounts**, not text — `sameAmount()` in `src/lib/money.ts`, which parses both sides
through `toCents` and treats two unparseable strings as equal only when both are blank. Re-measured against
the real endpoint: **0 rows reported as changing, 148 matching.** That number is the feature's acceptance
test, not a nicety.

Found by asking the deployed preview endpoint what it thought changed and aggregating by field, rather than
by reading the comparison and reasoning about it. The aggregate made it obvious in one line (`78 price`);
the code looked fine.

### Preview and apply are one function

`importProducts(read, { apply })` computes the entire plan and then either writes it or does not. A separate
preview path is a second implementation of the same rules, and the day they disagree is the day somebody
confirms a diff and gets a different result. The route calls it twice with the same file — once to show,
once to write — and re-derives both times rather than trusting a posted plan, so a file swapped between the
two steps is diffed afresh instead of applied blind, and there is no plan in the request body to tamper
with. Cost: one extra parse of an 8 MB-max file. Verified: after a preview, the fixture's price was still
1000 cents.

### The blank rule needs the header row

A column **deleted** from the file must be left alone; a cell **emptied** in a column that is still there
must be cleared. Neither cell-level reading gives both — "blank means skip" makes clearing a field
impossible, and "blank means clear" means deleting a column you did not need wipes it from every product.
So the reader returns `headers` alongside the rows, and the importer asks which columns were present. This
is why `SheetRows` is `{ headers, rows }` and not `Record<string, string>[]`.

Verified end to end: emptying `subtitle_en` left `{"sq": "nenshkrim"}` — the English half cleared, the
Albanian half untouched. An empty string is written as an **absent key**, not `""`, because `pickLocale`
falls back on absence; storing `en: ""` hands an English reader a confident blank where Albanian text
exists.

### What a file may not do

- **Publish.** Compliance approves a published product, because a published product is a health claim in
  front of a customer. A file that could flip that gate would make the checklist advisory.
- **Change the web address of a published product.** CLAUDE.md §10.
- **Create products or variants.** A new product needs an unused slug, a brand, an Albanian name, and then
  a variant with a globally unique SKU before it is anything, and `one_default_variant` is a partial unique
  index that can fail in a second way. That is the create form's job. Doing it here would mean a typo in the
  id column silently minting duplicates of the catalogue. The refusal says where to go instead.

### Splitting the rules out of the server-only importer

`sheet-import.ts` opens a Supabase client at the top of `importProducts`, so a test that wanted to ask "is
`1.234,50` refused?" would have had to mock a database to find out. The per-cell rules moved to
`sheet-cells.ts`, each returning a verdict **and the sentence the operator will read** — 28 tests, no
mocks. Same split as `pending-queues.ts` beside `pending.ts` (§ AK), and the same reason: `server-only`
throws under jsdom, and a rule that cannot be tested cheaply will not be tested.

Keeping the message beside the rule is deliberate. The report is not assembled from codes defined
elsewhere, so the two cannot drift.

`1.234,50` is refused rather than interpreted, because guessing which mark is the decimal is exactly how a
price ends up a hundred times too high. `9,90` parses.

### The teardown that looked clean while leaking

`e2e/helpers/accounts.ts:deleteCreatedUsers` was one line:

```ts
for (const id of createdUsers) await service?.auth.admin.deleteUser(id);
```

`deleteUser` **fails** for any fixture that performed an audited action — `audit_logs_actor_id_fkey`
references `profiles(id)` with no `on delete` clause, so the audit row pins the profile. That refusal is
correct (§10 forbids destroying audit history). Discarding it was not.

Measured rather than assumed. Against a fixture with one audit row:

| step | result |
| ---- | ------ |
| old one-liner: `deleteUser(id)` | error, **ignored** |
| profile afterwards | present, `role=admin` |

Then a sweep of `%@biocode.test` found **nine** leaked fixture admins — every fixture from this session that
had performed an audited action, which is exactly what the bug predicts. A shared database accumulating
staff-privileged rows is what the teardown exists to prevent.

Now three steps: demote to `customer` (a fixture that cannot be removed must at least not keep its
privileges), try the hard delete, fall back to Supabase's soft delete, and **report** anything still
standing. Reported with `console.warn` rather than a throw, because failing teardown would mask the result of
the test that just ran.

Writing that report surfaced a second defect in the fix itself: the foreign-key refusal arrives as `{}`, so
`error.message` is `undefined` and the warning printed `id: undefined`. It now falls back to
`JSON.stringify`.

### A cleanup that went wider than it needed to

The sweep that removed those nine profiles also deleted their audit rows — 32 of them — because the FK
otherwise blocks the delete. They were rows this session's own fixtures had generated hours earlier
(`product.removed`, `brand.purged`, `product.duplicated`) against fixtures the same scripts then destroyed.

It was still the wrong shape for the job. §10 says never hard-delete audit rows, and the script deleted them
in a loop on the strength of the actor's email pattern, without checking each row's `entity_id` against the
fixture patterns — and it printed only `action` and `created_at`, so after the fact there is no way to
confirm every one of the 32 referenced a fixture entity rather than a real one. The check that would have
made this verifiable cost one column in a `select`.

The rule that follows: **a script that deletes audit rows must qualify each row, and must print what it is
about to delete in full.** An actor-level pattern match is not a qualification of the row. Anything that
cannot be qualified stays, and the profile stays soft-deleted with it — which is what
`deleteCreatedUsers` now does.

### Reporting the plan as if it were the outcome

Four defects in the sheet import, all the same mistake: the write phase is four sequential loops with no
transaction, and every number shown afterwards came from the **plan** rather than from what the loops managed.

Forced by giving two draft products the same slug in one file, so the first write succeeds and the second hits
the unique index. Before and after, on the same file:

| | before | after |
| --- | --- | --- |
| headline | `Saved. 2 rows updated.` | `Partly saved. 1 of 2 rows updated.` |
| audit rows written | **2** — one for a change that never happened | 1 |
| the failure | listed | listed |
| the instruction below it | `Confirming saves the rows above…` | `Fix these in the file… Everything else is saved.` |
| category/goal write errors | discarded silently | reported |
| variant whose product vanished | `continue`, no trace | reported |

The audit row is the worst of the four. The stated reason for auditing per product rather than per import is
so somebody can answer *"what did that file do to the price of this product?"* — and auditing the plan answers
that question **wrongly**, which is worse than not answering it. A refused write read as a change that
happened.

`plan.wrote` now carries the real counts, `auditMany` receives only the products in `wroteProduct`, and the
panel treats a shortfall as a warning rather than a success — no green tick on a partial save.

Two things the run also exposed, both visible to an operator and both mine:
- `1 row were not saved` — the pluralisation branched on the noun and not the verb.
- `Products row 0 · …` — `row: 0` is the sentinel for a write-phase failure, which has no line in the file.
  Printing it sends the operator looking for a row that does not exist. Suppressed when zero.

The rule: **a count shown after an action must be counted from the action, not from its plan.** Anywhere those
two can differ, they eventually will, and the plan is always the more convenient one to reach for.

### What an adversarial pass over the sheet found the same day it shipped

Five independent lenses over the repo, each finding attacked by a skeptic that defaulted to "not real": 15
findings verified, 9 survived. The survivors in the sheet code were all the same shape — **a rule enforced
somewhere else that this path did not know about.**

**A price raised above its own was-price.** `compare_at_price_cents int check (compare_at_price_cents >
price_cents)`. `readMoneyCell` judges one amount against its own previous value and cannot see the other
column, so raising the price of an on-sale variant previewed as a clean change and then failed on write as
`Could not be saved.` Not a corner case: it is a price round, the operation the feature exists for, and live
seeded data hits it (`ON-GSW-2270-CHOC`, 69.90 against a was-price of 79.90). Now refused at plan time:
*"A was-price of 79.90 is not above the price of 79.90. Raise it or clear the compare_at_price cell."*

**Moving the default variant.** `one_default_variant` is a partial unique index, so promoting one variant
while another is still default fails with 23505. The form path clears the incumbent first and says why; this
path did not, and the result was decided by the alphabet — the export orders variants by SKU and writes
followed file order:

| the file says | what happened before |
| --- | --- |
| promote a SKU sorting **after** the incumbent | worked |
| promote a SKU sorting **before** the incumbent | promotion refused, demotion succeeded — **product left with no default at all** |
| promote without demoting | 23505, reported as *"Another variant already uses that SKU"* |

The misdiagnosis was the worst part: it sends the operator hunting a SKU collision that does not exist. Now
demotions are ordered before promotions, and a promotion with no matching demotion is refused by name.
Verified in the order that used to break: `Saved. 2 rows updated`, exactly one default, the right one.

**A formula whose result is an Excel error.** Measured, not assumed: such a cell reads back as
`{ formula: 'B99/0', result: { error: '#DIV/0!' } }`, and the `String(value)` fallback turned it into the
literal text **`[object Object]`** — written into a product name on the live shop. Empty would be no better;
an empty cell in a present column means *clear this field*. The reader now records it in `badCells` and the
row is refused, naming the column and the Excel error.

**Two columns with the same heading.** Rows are keyed by header name, so the rightmost duplicate silently won
and the other column's data was discarded — or landed in a field the operator meant to leave alone. Reachable
by copying a column to keep a working copy of a field. Refused, with both names.

**Tabs reordered.** The products sheet is found by name with a positional fallback, so dragging Variants to
the front made it *the* products sheet: seventy identical `No id` complaints under a heading saying nothing
would change — a description of the file rather than of the mistake. The sheet must now contain an `id`
column.

**A renamed Variants tab.** Found by name, then by `/variant/`. Miss both — call it `Cmimet` — and every
price edit in the file was discarded under a cheerful `Saved.` Deleting the sheet to edit product fields only
is legitimate, and the two cases are indistinguishable from here, so it is reported rather than refused.

**The last active variant of a published product.** `publish_requires` gates the transition into `published`,
not edits afterwards, so the database allows a published product to end up with nothing active — a live page
that cannot be bought. The editor refuses it in app code; the sheet was the way around that rule. Counted per
product across the whole file, because deactivating three of four variants is fine and the fourth is not.

**Row numbers.** Blank rows are skipped while reading, and the importer computed `index + 2`, so one stray
blank shifted every row number after it. A refusal naming row 41 when the operator's row 41 is fine is worse
than one naming no row at all. The reader now returns the real worksheet numbers.

**A variant renamed in English only** previewed as `variant name: 120 kapsula → 120 kapsula` — a change to
nothing — because the diff line always showed the Albanian pair. It names the locale now.

### One test that could not fail

`does not let Excel reinterpret a SKU as a date` round-tripped `MAR-3` and asserted it came back unmangled.
It always does: ExcelJS writes the string and reads the string, whatever the format. The mangling happens in
**Excel the application**, on open, when the column is General — which no unit test can observe. So the test
passed with `numFmt: '@'` removed, which is precisely the regression it was written to catch.

Rewritten to assert the column format, which is the thing that actually prevents it and which a unit test can
see. The general rule: **if deleting the mechanism leaves the test green, the test is about something else.**

### What did not survive

Six of fifteen were refuted, and two are worth recording because they read convincingly:

- *"An exception mid-write reports 'Nothing would change' after writing half the catalogue."* The premise was
  that supabase-js rejects on transport failure. It does not — `PostgrestBuilder.then()` resolves errors into
  the result object, so the write loops cannot throw partway.
- *"CSP enforcement would switch on an unmeasured policy."* Inverted: the header that survives Next's dedupe
  is the stricter one, and the enforced candidate carries `'unsafe-inline'` deliberately.

Both were plausible readings of real code. Refuting them cost less than acting on them would have.

### A note on whitespace, which turned out not to be a bug

The reader trims every cell, so stored text with leading or trailing whitespace would round-trip as a spurious
change and be silently rewritten — the same shape as the `10.90` / `10.9` bug. Before fixing it I counted:
**0 padded fields across 70 products.** Unreachable with real data, so it stays unfixed and written down
instead. The check cost one query; the fix would have cost a comparison rule on every text field.
