# 14 · Launch Readiness Ledger

Honest status against the launch checklist in `docs/10 §9` and the milestones in `docs/12`.

**Bottom line: it is a store. A guest can buy something, end to end, and pay cash on
delivery.** Add to cart → four-step checkout → order placed by the `checkout_create_order`
transaction → gated success page → track it later with the order number and email. Verified
against the live database by 204 Playwright tests across desktop and a 390 px viewport.

**It can also now fulfil what it sells.** Support signs in, works a queue, confirms, ships with
tracking, delivers, cancels with a reason and refunds — every mutation audited, every transition
enforced by the database. Journey 7 walks the whole path in a browser on each run.

**And it can now be stocked with a real catalogue.** A product manager creates a product, fills
six tabs, uploads images, submits it; compliance reads the claims in both languages and approves;
the storefront serves it on the next request. Brands, categories, health goals and ingredients
are all editable in the panel. Nothing needs SQL any more.

**What is left before a real customer: the email, and the products themselves.** Transactional
emails record `skipped_no_provider` until a Resend key and a verified sending domain exist (§6),
and the shop still sells 24 demo fixtures until somebody enters the real ones. `docs/12` still
puts the earliest genuinely shippable point after **M8**.

Legend: ✅ done and verified · 🟡 partial · ⬜ not started · ➖ not applicable yet

---

## 1 · Infrastructure and pipeline

| Item                                                  | State | Evidence                                                                                       |
| ----------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| Next.js app builds for production                     | ✅    | `pnpm build`, 46 routes, no warnings                                                           |
| First Load JS within the 170 kB budget (`docs/09 §3`) | ✅    | 120–138 kB per route, enforced by `check:bundle`                                               |
| Database schema applied                               | ✅    | 14 migrations on `rszbpdgfvyofvmuishmn`, Postgres 17.6                                         |
| RLS enabled on every public table (`docs/10 §4`)      | ✅    | `tables_without_rls()` → `[]`                                                                  |
| Integration suite against a real database             | ✅    | **45/45**, ~85 s                                                                               |
| Unit suite                                            | ✅    | **97/97**                                                                                      |
| E2E + axe on both locales                             | ✅    | **204/204**, repeatable; zero serious/critical violations on cart, checkout, account and admin |
| Generated DB types match the live schema              | ✅    | `db:types:linked` → 2902 lines, `pnpm verify` green                                            |
| CI pipeline (quality · integration+E2E · audit)       | ✅    | `.github/workflows/ci.yml`                                                                     |
| Security headers (`docs/10 §5`)                       | ✅    | asserted by an E2E test                                                                        |
| `/api/health` for uptime monitoring (`docs/10 §6`)    | ✅    | returns `{status:"ok",database:"ok"}`                                                          |
| Sitemap + robots with hreflang (`docs/08 §4`)         | ✅    | 176 URLs, 352 hreflang links                                                                   |
| Housekeeping cron, `CRON_SECRET`-guarded              | ✅    | 401 unauthenticated, 200 with token                                                            |
| On-demand ISR purge, secret-guarded                   | ✅    | rejects unknown tags, 401 unauthenticated                                                      |
| Sentry server + edge                                  | ✅    | inert without a DSN; client SDK lazy-loaded                                                    |
| `vercel.json` — region `fra1`, crons                  | ✅    |                                                                                                |
| Vercel project + domain + DNS                         | ⬜    | **owner task** (`docs/00`)                                                                     |
| Resend domain verified (SPF/DKIM/DMARC)               | ⬜    | **owner task** — until then customers get no order receipt                                     |
| Supabase staging + production projects                | ➖    | **owner decision (§7)** — one project serves all three roles                                   |
| PITR / backups on production                          | ⬜    | **owner task**, `docs/10 §4`. More urgent under §7: no second database to fall back on         |
| Destructive suites gated on `SUPABASE_TEST_PROJECT`   | ✅    | integration, E2E and the purge all refuse an undeclared target (§7)                            |
| Uptime monitor pointed at `/api/health`               | ⬜    | **owner task**                                                                                 |
| Restore drill                                         | ⬜    | `docs/10 §7`                                                                                   |

## 2 · Product — selling, fulfilling and stocking all work; the shop floor is still fixtures

| Milestone                                    | State | What it means is missing                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0 · Scaffold                                | ✅    | —                                                                                                                                                                                                                                                                                                                                          |
| M1 · Database and seed                       | ✅    | Schema + 24-product catalogue live. `scripts/seed-users.ts` and review fixtures outstanding                                                                                                                                                                                                                                                |
| M2 · Auth and account shell                  | ✅    | Sign up / in / out, password reset, account overview and settings                                                                                                                                                                                                                                                                          |
| M3 · Catalog browse                          | 🟡    | PLP, category, PDP, home, brands, goals, ingredients and SEO done. `/knowledge` and `/offers` outstanding                                                                                                                                                                                                                                  |
| M4 · Cart and COD checkout                   | ✅    | Guest cart, cart page, 4-step checkout, gated success page, order lookup. Confirmation email needs Resend (§6)                                                                                                                                                                                                                             |
| M5 · Orders ops and admin core               | ✅    | Admin shell, order queue + detail, full state machine, shipment, refund, lifecycle emails, dashboard, print docs, customer order pages                                                                                                                                                                                                     |
| M6 · Admin catalog management                | ✅    | Create → edit → variants → label → media → SEO → submit → approve → live (journey 8). All six editor tabs, brands/categories/goals/ingredients admin, brand-logo upload, the compliance queue. Cache tags on every catalogue read (docs/13 §K1). Deferred and listed below: drag-reorder, lab reports, taxonomy SEO, unsaved-changes guard |
| M7 · Reviews, wishlist, search, compare      | ⬜    |                                                                                                                                                                                                                                                                                                                                            |
| M8 · Knowledge, offers, contact, newsletter  | 🟡    | Newsletter opt-in works; double opt-in email needs Resend (M8)                                                                                                                                                                                                                                                                             |
| M9 · Subscriptions and loyalty               | ⬜    | RPCs and triggers exist and are tested; no UI                                                                                                                                                                                                                                                                                              |
| M10 · Inventory ops, finder, remaining admin | ⬜    |                                                                                                                                                                                                                                                                                                                                            |
| M11 · Hardening and launch                   | 🟡    | The ops half is done (this table §1). Performance, security and soak passes need the real product first                                                                                                                                                                                                                                    |

## 3 · Compliance and legal — must clear before any real customer

| Item                                                        | State | Note                                                                                                                                                           |
| ----------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplement disclaimer on required surfaces (`docs/08 §7.3`) | ✅    | Footer, PDP, ingredient and goal pages, asserted in E2E                                                                                                        |
| Terms, privacy, shipping/returns                            | 🟡    | Seeded as `[LEGAL: review]` placeholders — **must be written and legally reviewed**. Checkout now makes customers accept them, so this is on the critical path |
| Cookie/analytics consent banner (`docs/01 §4`)              | ⬜    | M8. No analytics script ships yet, so nothing is currently collected without consent                                                                           |
| Claim-language review (`docs/08 §7`)                        | 🟡    | 24 seeded products and 20 ingredients written inside the permissible-function wording of `docs/08 §7.2`; needs a human pass before launch                      |
| Health-goal intros                                          | 🟡    | 16 goals seeded with `[CONTENT: replace]`; `docs/05 §5` requires 150+ unique words each                                                                        |
| Brand assets                                                | 🟡    | Real brand names used as fixtures with **placeholder logos** — replace with authorised assets before prod (`docs/11 §5`)                                       |

## 4 · Deploying the shell now

Safe and useful — it proves DNS, env, headers, ISR, cron auth and monitoring before any
feature depends on them. Follow `runbooks/deploy.md`.

Two things to set deliberately:

1. **`robots.txt` follows `NEXT_PUBLIC_SITE_URL`.** On a staging domain, either password-protect
   the deployment (Vercel Protection) or the shell can be indexed — a half-built store in
   Google is worse than no store.
2. **Do not point production at `rszbpdgfvyofvmuishmn`.** It is the disposable dev project
   and the integration suite writes to whatever `.env.local` targets. Production needs its
   own Supabase project.

## 5 · The next decision

M6, and like M5 it is not really a decision. Orders can now be taken and fulfilled, but the
only things in the shop are fixtures — and `pnpm purge:demo` cannot run until real products
exist to replace them (§7, step 2). The product editor is therefore the last thing standing
between this and a shop that sells something real.

`docs/13 §E2` settled the Next 15 → 16 question by measurement — it stays on 15 for now.

## 6 · Owner tasks blocking the sale being _complete_

These are the ones that need an account or a domain, not code:

| Task                               | Why it blocks                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RESEND_API_KEY` + verified domain | **Deferred by the owner (2026-07-31).** The order-confirmation email is written, templated in both locales and wired into `placeOrder`; without the key `lib/email/send.ts` records `skipped_no_provider` and no-ops. Nothing breaks — but **customers get no receipt**, which for a cash-on-delivery shop in a new market is the main trust signal at the moment of purchase. Reversible at any time by adding the key; needs SPF, DKIM and DMARC on the sending domain |
| Vercel project + domain + DNS      | `runbooks/deploy.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Legal copy for terms and privacy   | Checkout requires customers to accept them; they are currently `[LEGAL: review]` placeholders                                                                                                                                                                                                                                                                                                                                                                            |

---

## 7 · One Supabase project for dev, test and production

The owner decided on **2026-07-31** that `rszbpdgfvyofvmuishmn` serves all three roles rather
than creating a separate production project. This section exists because that choice moves
three risks from "impossible by construction" to "prevented by a guard", and a guard is only
as good as the checklist that keeps it in place.

### What was changed to make it survivable

**A fail-closed declaration.** `SUPABASE_TEST_PROJECT` must be set and must equal the project
ref in `NEXT_PUBLIC_SUPABASE_URL`, or the integration suite, the E2E suite and the fixture
purge all refuse to start. Not a boolean — a ref, so it stops matching the moment the target
changes, whereas `ALLOW=1` in a shell profile would follow you anywhere. `127.0.0.1` is exempt,
being disposable by definition.

The guard it replaced refused a list of `shneta.com` hostnames, which could never have fired:
a Supabase database is at `<ref>.supabase.co`, never at the site's hostname. It was written
assuming dev and prod were different projects and protected nothing once they were not.

**The one unscoped deletion, scoped.** `purgeFixtures` deleted every guest cart
(`user_id is null`) with no fixture filter — on a live shop, every anonymous basket, every
test run, silently. It is now limited to _empty_ guest carts, which costs nobody anything:
`ensureCart()` mints a new one when a token stops resolving. Carts holding items are left to
the housekeeping cron's normal expiry.

**A reviewable pre-launch cleanup.** `pnpm purge:demo --dry-run` / `--yes` removes the 24
fixture products, 20 fixture ingredients and 4 test coupons. It refuses to delete a fixture
product that has been ordered, because `order_items.variant_id` is `on delete set null` and
deleting it would destroy the link from the order to what was sold.

### Launch checklist — every line is blocking

| #   | Do this                                              | Why                                                                                                                                                                                 |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Enter the real catalogue (needs M6's product editor) | The storefront currently sells fixtures                                                                                                                                             |
| 2   | `pnpm purge:demo --dry-run`, read it, then `--yes`   | 24 fake products with real brand names and unlicensed logos, and 3 **active** coupons. A customer can otherwise buy something that does not exist, or take 10% off with `WELCOME10` |
| 3   | **Delete `SUPABASE_TEST_PROJECT` from `.env.local`** | This single line is what stands between `pnpm test:e2e` and customer data. After removing it, both suites refuse to run against this project — which is the point                   |
| 4   | Never set `SUPABASE_TEST_PROJECT` in Vercel          | It has no purpose in a deployed environment and every purpose in a destructive one                                                                                                  |
| 5   | Enable Point-in-Time Recovery (paid add-on)          | There is no second database to fall back on. Orders, addresses and phone numbers with no restore point is not a recoverable position                                                |
| 6   | Confirm `tables_without_rls()` returns `[]`          | Cheap, and the whole security model rests on it                                                                                                                                     |

### What is permanently given up

**There is nowhere to run the destructive suites after step 3.** Docker is not installed on
the build machine, so the local stack is unavailable; the integration and E2E suites are the
acceptance gate for every remaining milestone (M5–M11). From step 3 onward, verifying a
milestone means either a second Supabase project (the free tier allows two, so a test-only
project costs nothing) or installing Docker for `supabase start`. Deferring this is fine.
Discovering it on launch day is not — which is why it is written here rather than left to be
found.

---

## 8 · The demo catalogue cannot be re-published

Migration 14 made publishing conditional on an active variant, an image, a primary category and
compliance approval (docs/06 §3). Checking the 24 seeded products against it:

    published products meeting the guard: 0 / 24
    every one is missing: image, approval

This is **not a regression** — the trigger fires on the transition _into_ published, so rows
already published stay published and the storefront is unaffected. It is the guard correctly
reporting that the fixture catalogue was never complete:

- `pnpm seed:images` (docs/11 §10) was never written, so no product has a `product_images`
  row. The storefront renders the branded fallback tile instead, which is why nobody noticed.
- The seed sets `status = 'published'` directly, without an approver, because it runs as the
  service role — which the guard exempts for exactly that reason.

**What it means in practice:** archive a seeded product and you cannot restore it to published
without adding an image and having compliance approve it. That is the correct behaviour, and it
is a preview of the real workflow.

**What it means for launch:** every real product needs an image before it can go live. That is
already implied by §7 step 1, but the guard now enforces it rather than trusting the operator to
remember — which is the right place for it.

---

## 9 · What M6 deliberately left out

The catalogue admin is complete enough to enter and publish a real catalogue. Six things in
docs/06 §3–§7 and §14 are not built, each for a stated reason rather than because time ran out.

| Item                                                  | Why it is not here                                                                                                                                                                                                                                 | When                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Drag-reorder for the category tree and goal tiles     | Ships as a `sort_order` number and a "sits inside" select. Works without JavaScript, unambiguous over a hierarchy, and replaceable later without a schema change (docs/13 §L5)                                                                     | Any time; no data change                                 |
| Lab report upload (`lab-reports`, private bucket)     | No storefront component renders a certificate of analysis yet. An uploader for a document no customer can reach has no observable effect — the same class of defect as a cache purge with no tag (docs/13 §L4)                                     | With docs/05 §3's PDP section                            |
| `seo` jsonb on brands, categories, goals, ingredients | Nothing reads it. Product SEO shipped **with** its reader in `generateMetadata`; taxonomy SEO would be a writer alone                                                                                                                              | With docs/08 §4                                          |
| Certifications registry CRUD (docs/06 §14)            | The product editor can attach existing certifications, which is what publishing needs. Creating them is a once-a-quarter act better done with a migration than a screen                                                                            | M10, with the remaining admin                            |
| Approve-without-publish from the queue                | The action supports it, but it leaves the product at `pending_review`, so the item would stay in a queue with no sign it was handled. Needs an "approved, awaiting launch" status the schema does not have (docs/13 §L3)                           | With docs/07 §10                                         |
| Unsaved-changes guard on the editor (docs/06 §16)     | Each tab is its own form posting its own action, so switching tabs with unsaved edits loses them. Known, and called out at the top of `product-editor.tsx`                                                                                         | M11 hardening                                            |
| Variant `options`, `weight_grams`, `barcode`, cost    | The six tabs are all present; four **fields** inside Variants are not. `options` is fetched but never rendered — the BuyBox labels a variant by its name — and the other three have no reader at all yet (flat-rate shipping, no margin reporting) | Cost with M10; the rest with the feature that reads them |

Two carried over from earlier milestones and still outstanding: `pnpm seed:images` (§8), and the
in-app notification a rejected product manager should get instead of being told in person
(docs/06 §14 — the note currently lives only in `audit_logs`).
