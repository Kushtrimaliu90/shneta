# 14 · Launch Readiness Ledger

Honest status against the launch checklist in `docs/10 §9` and the milestones in `docs/12`.

**Bottom line: the pipeline is production-ready and the storefront is now browsable. It is
still not a store — nothing can be bought.**
A customer can register, sign in, browse 24 products, filter and sort them, open a product
and read its full label. They cannot add anything to a cart or place an order, because that
is M4. `docs/12` puts the earliest shippable point after **M8**.

Legend: ✅ done and verified · 🟡 partial · ⬜ not started · ➖ not applicable yet

---

## 1 · Infrastructure and pipeline

| Item                                                  | State | Evidence                                                |
| ----------------------------------------------------- | ----- | ------------------------------------------------------- |
| Next.js app builds for production                     | ✅    | `pnpm build`, 11 routes, no warnings                    |
| First Load JS within the 170 kB budget (`docs/09 §3`) | ✅    | 119–134 kB per route, enforced by `check:bundle`        |
| Database schema applied                               | ✅    | 12 migrations on `rszbpdgfvyofvmuishmn`, Postgres 17.6  |
| RLS enabled on every public table (`docs/10 §4`)      | ✅    | `tables_without_rls()` → `[]`                           |
| Integration suite against a real database             | ✅    | **44/44**, ~57 s                                        |
| Unit suite                                            | ✅    | **87/87**                                               |
| E2E + axe on both locales                             | ✅    | **84/84**, repeatable; zero serious/critical violations |
| Generated DB types match the live schema              | ✅    | `db:types:linked` → 2902 lines, `pnpm verify` green     |
| CI pipeline (quality · integration+E2E · audit)       | ✅    | `.github/workflows/ci.yml`                              |
| Security headers (`docs/10 §5`)                       | ✅    | asserted by an E2E test                                 |
| `/api/health` for uptime monitoring (`docs/10 §6`)    | ✅    | returns `{status:"ok",database:"ok"}`                   |
| Sitemap + robots with hreflang (`docs/08 §4`)         | ✅    | 176 URLs, 352 hreflang links                            |
| Housekeeping cron, `CRON_SECRET`-guarded              | ✅    | 401 unauthenticated, 200 with token                     |
| On-demand ISR purge, secret-guarded                   | ✅    | rejects unknown tags, 401 unauthenticated               |
| Sentry server + edge                                  | ✅    | inert without a DSN; client SDK lazy-loaded             |
| `vercel.json` — region `fra1`, crons                  | ✅    |                                                         |
| Vercel project + domain + DNS                         | ⬜    | **owner task** (`docs/00`)                              |
| Resend domain verified (SPF/DKIM/DMARC)               | ⬜    | **owner task**; no email is sent yet                    |
| Supabase staging + production projects                | 🟡    | one dev project exists; staging/prod not created        |
| PITR / backups on production                          | ⬜    | **owner task**, `docs/10 §4`                            |
| Uptime monitor pointed at `/api/health`               | ⬜    | **owner task**                                          |
| Restore drill                                         | ⬜    | `docs/10 §7`                                            |

## 2 · Product — the blocking gap

| Milestone                                    | State | What it means is missing                                                                                |
| -------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| M0 · Scaffold                                | ✅    | —                                                                                                       |
| M1 · Database and seed                       | ✅    | Schema + 24-product catalogue live. `scripts/seed-users.ts` and review fixtures outstanding             |
| M2 · Auth and account shell                  | ✅    | Sign up / in / out, password reset, account overview and settings                                       |
| M3 · Catalog browse                          | 🟡    | PLP, category pages, PDP, home and SEO done. Brands/goals/ingredients/knowledge pages outstanding       |
| M4 · Cart and COD checkout                   | ⬜    | **Nothing can be bought.** The RPC exists and is tested; no UI reaches it                               |
| M5 · Orders ops and admin core               | ⬜    | No admin panel; orders cannot be fulfilled                                                              |
| M6 · Admin catalog management                | ⬜    | Products can only be created by SQL                                                                     |
| M7 · Reviews, wishlist, search, compare      | ⬜    |                                                                                                         |
| M8 · Knowledge, offers, contact, newsletter  | 🟡    | Newsletter opt-in works; double opt-in email needs Resend (M8)                                          |
| M9 · Subscriptions and loyalty               | ⬜    | RPCs and triggers exist and are tested; no UI                                                           |
| M10 · Inventory ops, finder, remaining admin | ⬜    |                                                                                                         |
| M11 · Hardening and launch                   | 🟡    | The ops half is done (this table §1). Performance, security and soak passes need the real product first |

## 3 · Compliance and legal — must clear before any real customer

| Item                                                        | State | Note                                                                                                                     |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| Supplement disclaimer on required surfaces (`docs/08 §7.3`) | 🟡    | Present in the footer. PDP ingredients tab, ingredient and knowledge pages arrive with M3                                |
| Terms, privacy, shipping/returns                            | 🟡    | Seeded as `[LEGAL: review]` placeholders — **must be written and legally reviewed**                                      |
| Cookie/analytics consent banner (`docs/01 §4`)              | ⬜    | M8. No analytics script ships yet, so nothing is currently collected without consent                                     |
| Claim-language review (`docs/08 §7`)                        | ➖    | No product copy exists yet                                                                                               |
| Health-goal intros                                          | 🟡    | 16 goals seeded with `[CONTENT: replace]`; `docs/05 §5` requires 150+ unique words each                                  |
| Brand assets                                                | 🟡    | Real brand names used as fixtures with **placeholder logos** — replace with authorised assets before prod (`docs/11 §5`) |

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

`docs/13 §E` flags the **Next 15 → 16** upgrade as a decision to take before M3, while the
surface area is still small. It changes caching semantics that the whole pack is written
against, so it gets cheaper to do now and more expensive at every milestone after.
