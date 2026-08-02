# 12 · Build Plan — Milestones for Claude Code

One milestone ≈ one focused session (M1, M5 may take two). Order is dependency- and risk-driven; do not reorder. Every milestone ends with the CLAUDE.md Definition of Done plus its own acceptance criteria. Commit per milestone. Read the listed docs before starting.

## M0 — Scaffold & foundations _(docs: 02, 04, 10)_

Init Next 15 + TS strict + Tailwind v4 + shadcn/ui + next-intl (sq/en, as-needed prefix) + fonts + tokens (`globals.css` from docs/04 §3–5) + folder structure (02 §4) + ESLint/Prettier/jsx-a11y + Vitest + Playwright configs + `lib/{money,result,i18n,env,utils}.ts` with unit tests + CI workflow (quality job) + `.env.example`. Build the app shell: Navbar (static links), Footer, locale switcher, home placeholder, not-found, error pages.
**Accept:** CI green; `pnpm dev` shows branded shell in sq and /en; money + pickLocale tests pass; Lighthouse on shell ≥ 95.

## M1 — Database & seed _(docs: 03, 11)_

All migrations from docs/03 in order (extensions/enums → helpers → tables → functions/triggers/RPC → RLS → indexes → storage → views), `supabase/seed.sql` + `scripts/seed-users.ts` + seed images step; `pnpm db:types` wired.
**Accept:** `supabase db reset` clean; RLS enabled on every public table (assert query); integration tests: RLS matrix core (anon vs customer vs staff), checkout RPC happy + out-of-stock + coupon paths, order state machine, rating trigger, ledger invariant — all green.

## M2 — Auth & account shell _(docs: 02 §8, 05 §14–15)_

Supabase SSR clients + middleware (session refresh, /account guard, /admin gate stub), auth pages (sign-in/up/forgot/reset/verify), profile auto-provisioning verified, account layout + Overview + Settings (name/phone/locale/marketing/password), rate limiting lib + applied to auth.
**Accept:** E2E journey 2 (through sign-in; merge comes in M4); non-enumerating errors; auth emails restyled note documented for dashboard.

## M3 — Catalog browse (read-only storefront) _(docs: 05 §1–7, 04, 08 §4)_

Home (all sections, data-driven), PLP with full filters/sort/pagination + facet counts, PDP complete except purchase actions live-wired (render variant/price/stock/label/reviews read-only), brands, goals, ingredients, knowledge hub + article page, static pages/FAQ from DB, SEO layer (`lib/seo.ts`, metadata, JSON-LD, sitemap, robots), ISR + cache tags.
**Accept:** all seed content renders bilingual; JSON-LD validates (Rich Results test on Product + Article fixtures); Lighthouse ≥ 95 Home/PLP/PDP; a11y smoke (axe) clean on these pages.

## M4 — Cart & COD checkout _(docs: 07 §1–6, 05 §12–13)_

Cart feature (server actions, guest cookie carts, merge on sign-in, drawer + page, coupon preview), checkout page (4 steps, address book integration, shipping methods, COD), `placeOrder` → RPC wiring, success page, order-lookup, email infra (`lib/email` + Resend) with order-confirmation template, revalidation hooks.
**Accept:** E2E journeys 1, 3, 4 green; totals parity unit test (UI preview vs RPC) green; double-submit safe; confirmation email logged in `email_log` and renders correctly (preview test).

## M5 — Orders operations & admin core _(docs: 06 §1–2, 07 §7, 08 §6)_

Admin shell (guarded layout, sidebar by role, ⌘K search), DataTable component, Dashboard v1 (KPIs, queues), Orders list + detail with full state-machine actions, shipment dialog, refund flow, audit helper wired to all admin mutations, remaining lifecycle emails (confirmed/shipped/delivered/cancelled/refund), customer account Orders list/detail + cancel-while-pending, print-styled invoice/packing slip.
**Accept:** E2E journeys 5, 7 green; integration: refund caps at paid, cancel restocks; audit rows written for every mutation; customer-safe timeline hides internal notes.

## M6 — Admin catalog management _(docs: 06 §3–7, 08 §7)_

Product editor (all 6 tabs incl. uploads to storage), categories tree, brands, ingredients, goals admin, compliance queue + approval gating publish, revalidation on writes, claims-language reminder panel.
**Accept:** E2E journey 8 green; publish blocked without variant/image/primary-category/approval; storefront reflects edits ≤ revalidate window and instantly via tag purge.

## M7 — Reviews, wishlist, search, compare _(docs: 05 §3/8/9, 06 §10)_

Review create (verified purchase), moderation UI, helpful votes, rating aggregates surfaced; wishlist end-to-end; quick search overlay + /search page (FTS+trgm queries); compare page; delivered+7d review-request cron.
**Accept:** E2E journeys 6, 10 green; typo search test passes; review from non-purchaser blocked with friendly explanation.

## M8 — Knowledge polish, offers, contact, newsletter _(docs: 05 §7/11/16, 08 §2–5)_

Article rendering polish ("Shop this article", related blocks, fallback notes), offers page, contact form + admin inbox, newsletter double opt-in flow + welcome email, cookie-consent banner + analytics events, FAQ JSON-LD.
**Accept:** E2E journey 11; double-opt-in verified via email_log; consent gates analytics script.

## M9 — Subscriptions & loyalty _(docs: 07 §8–9, 05 §14, 06 §12)_

SubscribeToggle → subscription creation at checkout, account Subscriptions management (skip/pause/frequency/items/cancel), cron `/api/cron/subscriptions` (T−3 notice with signed one-click links, due-run order generation with SUB-10 discount, failure handling), admin subscriptions, loyalty ledger UI + redeem-to-coupon, clawback on refund.
**Accept:** E2E journey 9 green; cron idempotency test (double invoke → one order); notice email links skip correctly without login.

## M10 — Inventory ops, finder, remaining admin _(docs: 06 §8–15, 05 §10)_

> The finder shipped in M10 and was **superseded after M11** by the BioHack Protocol Generator
> (docs/15). `/finder` now 308s to `/biohack`. The acceptance criteria below were ported rather
> than dropped — see docs/05 §10.

Inventory pages (receive/adjust with batch/expiry, movements, order queue + packing slips), customers admin (LTV, GDPR export/anonymize), coupons admin, content admin (articles/pages/FAQs/banners editors), settings suite (store/shipping/payments/tax/loyalty/team/audit), supplement finder quiz + scoring + results.
**Accept:** ledger invariant holds through receive/adjust E2E; finder completes < 60 s with non-empty results; team invite creates staff login; settings changes reflect on storefront (thresholds, methods).

## M11 — Hardening & launch _(docs: 09, 10)_

Full E2E suite (all 12 journeys) + axe pass across listed pages; performance pass to budgets (bundle analysis, image sizes, dynamic imports); security pass (docs/09 §5) incl. headers + CSP rollout; housekeeping cron; `/api/health`; Sentry wiring + alert test; runbooks (restore, incident, deploy); staging soak with full seed; execute launch checklist (docs/10 §9).
**Accept:** every checklist item ticked with evidence in the PR; green suite on staging; a rehearsed real test order delivered end-to-end.

## Post-v1 backlog (do not build now)

Bank POS adapter go-live · Meilisearch · zero-result search logging · back-in-stock notifications · abandoned-cart emails · gift-card balance system (v1 sells codes manually fulfilled) · Q&A on PDP · scheduled article publishing · Albanian market (ALL, .al) · Stripe/EU · vendor marketplace · wholesale · AI coach · mobile apps.

## Cut line (if timeline forces)

Ship after M8 with: subscriptions hidden, loyalty accruing silently (UI later), finder hidden, inventory via receive/adjust only. M9–M10 become fast-follows. Never cut: RLS tests, checkout integrity, emails, compliance gating.
