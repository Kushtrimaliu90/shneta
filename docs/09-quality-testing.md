# 09 · Quality & Testing

## 1. Test pyramid

- **Unit (Vitest, `tests/`):** pure logic — `money.ts` (format sq/en, totals parity with RPC formulas, rounding cases), coupon math, free-shipping thresholds, `pickLocale`, slug utils, Zod schemas (valid/invalid fixtures), the BioHack engine (pure, deterministic, mutation-verified), reading-time calc. Target: every exported function in `lib/` and every schema.
- **Integration (Vitest against local Supabase, `tests/integration/`):** run with `supabase start` + migrated + seeded DB, using service + user-JWT clients. Cover: checkout RPC (happy path; out-of-stock; coupon valid/invalid/exhausted/min-not-met; free-shipping; totals & tax math; stock decremented + ledger; converted cart can't reorder), order state machine (allowed/blocked transitions; delivered → COD paid + loyalty; cancelled → restock), RLS matrix (customer cannot read others' orders/carts/addresses; anon reads only published; each staff role's allowed writes; role escalation blocked), rating trigger, rate limiter, loyalty redeem.
- **E2E (Playwright, `e2e/`):** desktop Chrome + mobile viewport (390×844). Journeys:
  1. Guest browse → filter PLP → PDP variant switch → add to cart → full COD checkout → success page shows order number.
  2. Sign-up → verify (test inbox via Supabase local) → sign-in → guest-cart merge → checkout with saved address.
  3. Coupon apply (valid + invalid message) affects totals correctly.
  4. Order lookup with number+email; wrong pair → generic not-found.
  5. Account: view order, cancel while pending, wishlist add/remove, address CRUD.
  6. Review: buy → (test hook marks delivered) → write review → appears after admin approval.
  7. Admin: sign in as support seed user → confirm → ship (tracking) → deliver an order; timeline + emails logged.
  8. Admin PM: create product (all tabs) → compliance approves → appears on storefront (revalidation).
  9. Subscription: subscribe at PDP → account shows sub → cron endpoint (test-invoked) generates order with discount.
  10. Search typo-tolerance; compare page from 3 products; the BioHack generator end-to-end (three steps → result → add-all → share), the pregnancy gate, and the admin ruleset editor.
  11. i18n: /en renders translated chrome; sq fallback note on missing article body.
  12. a11y smoke: axe (`@axe-core/playwright`) on home, PLP, PDP, cart, checkout, account, one admin page — zero serious/critical violations.
- **Visual sanity (lightweight):** Playwright screenshots of home/PLP/PDP at 360/768/1280 stored as artifacts (manual review, not pixel-diff v1).

## 2. Test data & hooks

Seed (docs/11) is the fixture base. Test-only helpers behind `NODE_ENV==='test'`: endpoint to mark an order delivered, to invoke cron routes with CRON_SECRET, to fetch last email from `email_log`. Never shipped enabled to prod (guard + CI check).

## 3. Performance budgets (enforced pre-launch, tracked after)

LCP < 2.0 s p75 mobile · CLS < 0.1 · INP < 200 ms · TTFB < 500 ms on ISR hits · storefront route JS < 170 KB gz (checkout < 200) · image weight per viewport < 400 KB · Lighthouse ≥ 95 (perf/a11y/best-practices/SEO) on Home, PLP, PDP, article. Practices: RSC-first, dynamic import for heavy client widgets (gallery zoom, charts), `next/image` with correct `sizes`, font subset+swap, no third-party scripts except consented analytics.

## 4. Accessibility checklist (per milestone DoD)

Keyboard-complete flows (menu, filters, variant select, checkout, admin tables) · visible focus everywhere · form labels + error association (`aria-describedby`) · dialogs/drawers trap focus & restore · `aria-live` for cart/toast/async results · alt text from DB · contrast per tokens · reduced-motion honored · zoom 200% usable.

## 5. Security testing

RLS matrix suite (above) is mandatory and runs in CI. Manual pre-launch pass: IDOR attempts on orders/addresses/subscriptions, price tampering via forged action payloads (server must reprice), coupon brute-force hits rate limit, storage bucket listing/write attempts as anon and customer, admin routes unauthenticated, webhook without valid signature rejected, headers present (CSP report-only first week, then enforce). Dependency audit (`pnpm audit`) gate: no criticals.

## 6. Definition of Done reference

See CLAUDE.md; additionally every milestone in docs/12 names the specific tests that must exist and pass before it closes.
