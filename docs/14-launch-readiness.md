# 14 · Launch Readiness Ledger

Honest status against the launch checklist in `docs/10 §9` and the milestones in `docs/12`.

**Bottom line: it is a store. A guest can buy something, end to end, and pay cash on
delivery.** Add to cart → four-step checkout → order placed by the `checkout_create_order`
transaction → gated success page → track it later with the order number and email. Verified
against the live database by 116 Playwright tests across desktop and a 390 px viewport.

**What it still is not: a business that can fulfil what it sells.** There is no admin panel,
so a placed order cannot be confirmed, packed or marked shipped by anyone who is not writing
SQL — that is M5. And the order-confirmation email is written and wired but silently records
`skipped_no_provider` until `RESEND_API_KEY` and a verified sending domain exist (§6).
`docs/12` still puts the earliest genuinely shippable point after **M8**.

Legend: ✅ done and verified · 🟡 partial · ⬜ not started · ➖ not applicable yet

---

## 1 · Infrastructure and pipeline

| Item                                                  | State | Evidence                                                                   |
| ----------------------------------------------------- | ----- | -------------------------------------------------------------------------- |
| Next.js app builds for production                     | ✅    | `pnpm build`, 17 routes, no warnings                                       |
| First Load JS within the 170 kB budget (`docs/09 §3`) | ✅    | 120–138 kB per route, enforced by `check:bundle`                           |
| Database schema applied                               | ✅    | 13 migrations on `rszbpdgfvyofvmuishmn`, Postgres 17.6                     |
| RLS enabled on every public table (`docs/10 §4`)      | ✅    | `tables_without_rls()` → `[]`                                              |
| Integration suite against a real database             | ✅    | **45/45**, ~85 s                                                           |
| Unit suite                                            | ✅    | **89/89**                                                                  |
| E2E + axe on both locales                             | ✅    | **116/116**, four consecutive clean runs; zero serious/critical violations |
| Generated DB types match the live schema              | ✅    | `db:types:linked` → 2902 lines, `pnpm verify` green                        |
| CI pipeline (quality · integration+E2E · audit)       | ✅    | `.github/workflows/ci.yml`                                                 |
| Security headers (`docs/10 §5`)                       | ✅    | asserted by an E2E test                                                    |
| `/api/health` for uptime monitoring (`docs/10 §6`)    | ✅    | returns `{status:"ok",database:"ok"}`                                      |
| Sitemap + robots with hreflang (`docs/08 §4`)         | ✅    | 176 URLs, 352 hreflang links                                               |
| Housekeeping cron, `CRON_SECRET`-guarded              | ✅    | 401 unauthenticated, 200 with token                                        |
| On-demand ISR purge, secret-guarded                   | ✅    | rejects unknown tags, 401 unauthenticated                                  |
| Sentry server + edge                                  | ✅    | inert without a DSN; client SDK lazy-loaded                                |
| `vercel.json` — region `fra1`, crons                  | ✅    |                                                                            |
| Vercel project + domain + DNS                         | ⬜    | **owner task** (`docs/00`)                                                 |
| Resend domain verified (SPF/DKIM/DMARC)               | ⬜    | **owner task** — until then customers get no order receipt                 |
| Supabase staging + production projects                | 🟡    | one dev project exists; staging/prod not created                           |
| PITR / backups on production                          | ⬜    | **owner task**, `docs/10 §4`                                               |
| Uptime monitor pointed at `/api/health`               | ⬜    | **owner task**                                                             |
| Restore drill                                         | ⬜    | `docs/10 §7`                                                               |

## 2 · Product — selling works, fulfilment does not

| Milestone                                    | State | What it means is missing                                                                                       |
| -------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| M0 · Scaffold                                | ✅    | —                                                                                                              |
| M1 · Database and seed                       | ✅    | Schema + 24-product catalogue live. `scripts/seed-users.ts` and review fixtures outstanding                    |
| M2 · Auth and account shell                  | ✅    | Sign up / in / out, password reset, account overview and settings                                              |
| M3 · Catalog browse                          | 🟡    | PLP, category, PDP, home, brands, goals, ingredients and SEO done. `/knowledge` and `/offers` outstanding      |
| M4 · Cart and COD checkout                   | ✅    | Guest cart, cart page, 4-step checkout, gated success page, order lookup. Confirmation email needs Resend (§6) |
| M5 · Orders ops and admin core               | ⬜    | **The blocking gap now.** Orders can be placed but not confirmed, packed or shipped without SQL                |
| M6 · Admin catalog management                | ⬜    | Products can only be created by SQL                                                                            |
| M7 · Reviews, wishlist, search, compare      | ⬜    |                                                                                                                |
| M8 · Knowledge, offers, contact, newsletter  | 🟡    | Newsletter opt-in works; double opt-in email needs Resend (M8)                                                 |
| M9 · Subscriptions and loyalty               | ⬜    | RPCs and triggers exist and are tested; no UI                                                                  |
| M10 · Inventory ops, finder, remaining admin | ⬜    |                                                                                                                |
| M11 · Hardening and launch                   | 🟡    | The ops half is done (this table §1). Performance, security and soak passes need the real product first        |

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

M5, and it is not really a decision. Orders can now be placed and cannot be fulfilled, which
is the one state a store must never sit in for long: the gap between "a customer paid" and
"someone can act on it" is currently a SQL client. Until the admin order list, detail view and
status transitions exist, every order placed is a manual liability.

`docs/13 §E2` settled the Next 15 → 16 question by measurement — it stays on 15 for now.

## 6 · Owner tasks blocking the sale being _complete_

These are the ones that need an account or a domain, not code:

| Task                                   | Why it blocks                                                                                                                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY` + verified domain     | The order-confirmation email is written, templated in both locales and wired into `placeOrder`. Without the key `lib/email/send.ts` records `skipped_no_provider` and no-ops, so **customers get no receipt.** Needs SPF, DKIM and DMARC on the sending domain |
| A separate production Supabase project | `rszbpdgfvyofvmuishmn` is disposable and the test suites write to whatever `.env.local` targets                                                                                                                                                                |
| Vercel project + domain + DNS          | `runbooks/deploy.md`                                                                                                                                                                                                                                           |
| Legal copy for terms and privacy       | Checkout requires customers to accept them; they are currently `[LEGAL: review]` placeholders                                                                                                                                                                  |
