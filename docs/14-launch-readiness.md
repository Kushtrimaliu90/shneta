# 14 · Launch Readiness Ledger

Honest status against the launch checklist in `docs/10 §9` and the milestones in `docs/12`.

**Bottom line: it is a store. A guest can buy something, end to end, and pay cash on
delivery.** Add to cart → four-step checkout → order placed by the `checkout_create_order`
transaction → gated success page → track it later with the order number and email. Verified
against the live database by 116 Playwright tests across desktop and a 390 px viewport.

**It can also now fulfil what it sells.** Support signs in, works a queue, confirms, ships with
tracking, delivers, cancels with a reason and refunds — every mutation audited, every transition
enforced by the database. Journey 7 walks the whole path in a browser on each run.

**What is left before a real customer: the catalogue and the email.** Products can only be
created by SQL until M6, so the shop still sells 24 demo fixtures; and the transactional emails
record `skipped_no_provider` until a Resend key and a verified sending domain exist (§6).
`docs/12` still puts the earliest genuinely shippable point after **M8**.

Legend: ✅ done and verified · 🟡 partial · ⬜ not started · ➖ not applicable yet

---

## 1 · Infrastructure and pipeline

| Item                                                  | State | Evidence                                                                                       |
| ----------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| Next.js app builds for production                     | ✅    | `pnpm build`, 22 routes, no warnings                                                           |
| First Load JS within the 170 kB budget (`docs/09 §3`) | ✅    | 120–138 kB per route, enforced by `check:bundle`                                               |
| Database schema applied                               | ✅    | 13 migrations on `rszbpdgfvyofvmuishmn`, Postgres 17.6                                         |
| RLS enabled on every public table (`docs/10 §4`)      | ✅    | `tables_without_rls()` → `[]`                                                                  |
| Integration suite against a real database             | ✅    | **45/45**, ~85 s                                                                               |
| Unit suite                                            | ✅    | **97/97**                                                                                      |
| E2E + axe on both locales                             | ✅    | **156/156**, repeatable; zero serious/critical violations on cart, checkout, account and admin |
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

## 2 · Product — selling works, fulfilment does not

| Milestone                                    | State | What it means is missing                                                                                                               |
| -------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| M0 · Scaffold                                | ✅    | —                                                                                                                                      |
| M1 · Database and seed                       | ✅    | Schema + 24-product catalogue live. `scripts/seed-users.ts` and review fixtures outstanding                                            |
| M2 · Auth and account shell                  | ✅    | Sign up / in / out, password reset, account overview and settings                                                                      |
| M3 · Catalog browse                          | 🟡    | PLP, category, PDP, home, brands, goals, ingredients and SEO done. `/knowledge` and `/offers` outstanding                              |
| M4 · Cart and COD checkout                   | ✅    | Guest cart, cart page, 4-step checkout, gated success page, order lookup. Confirmation email needs Resend (§6)                         |
| M5 · Orders ops and admin core               | ✅    | Admin shell, order queue + detail, full state machine, shipment, refund, lifecycle emails, dashboard, print docs, customer order pages |
| M6 · Admin catalog management                | ⬜    | **The blocking gap now.** Products can only be created by SQL, so the real catalogue cannot be entered                                 |
| M7 · Reviews, wishlist, search, compare      | ⬜    |                                                                                                                                        |
| M8 · Knowledge, offers, contact, newsletter  | 🟡    | Newsletter opt-in works; double opt-in email needs Resend (M8)                                                                         |
| M9 · Subscriptions and loyalty               | ⬜    | RPCs and triggers exist and are tested; no UI                                                                                          |
| M10 · Inventory ops, finder, remaining admin | ⬜    |                                                                                                                                        |
| M11 · Hardening and launch                   | 🟡    | The ops half is done (this table §1). Performance, security and soak passes need the real product first                                |

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
