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
