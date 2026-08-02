# 01 · Product Overview

## 1. What BIOCODE is

BIOCODE is a multi-brand digital wellness marketplace for the Albanian-speaking world, launching in Kosovo and architected to expand to Albania, North Macedonia, Montenegro, the diaspora, and the wider EU. It combines a modern e-commerce experience with a wellness knowledge platform: customers buy supplements from multiple brands, understand ingredients, compare formulations, build routines, subscribe to repeat deliveries, and learn from evidence-informed content.

**Brand line:** _Your biology has a code. Unlock your potential._
**Campaign line:** _Unlock your biology._

**The idea.** Every person's biology is a system — one that can be read, supported and improved
with the right nutrition, supplementation and habits. BIOCODE sells the products, and just as
importantly sells the _understanding_: what an ingredient does, at what dose, and why it is in
your routine rather than somebody else's.

That positioning has three consequences the rest of these documents inherit:

1. **Transparency is the product, not a feature.** Full ingredient disclosure, %NRV, no
   proprietary blends. A brand that claims biology is legible cannot hide what is in the bottle.
2. **Personalisation is a readout, not a horoscope.** The finder's scoring is deterministic and
   explains itself per product (docs/05 §10) — "for Better Sleep, the one you picked first",
   never "our AI recommends".
3. **Restraint in the voice.** Premium and clinical, never hype. Anything that reads as a health
   claim is a compliance problem before it is a tone problem (docs/08 §7).

**Vision:** become the most trusted online destination for health and wellness products in the Balkans through transparent product information, intelligent technology, outstanding customer experience, and evidence-informed education.

**Mission:** empower customers to make better wellness decisions via trusted products, personalized recommendations, education, and a seamless shopping experience.

**BIOCODE is:** a wellness platform · an educational destination · a trusted marketplace · a digital health companion · a premium shopping experience.
**BIOCODE is not:** a bodybuilding-only shop · a pharmacy · a discount warehouse · a price-first marketplace.

**Core values:** Transparency (full ingredient/manufacturing/certification disclosure) · Trust · Simplicity · Education over sales pressure · Performance · Scalability.

## 2. v1 scope

**IN v1 (this pack):**

- Catalog: vitamins, minerals, sports nutrition, protein, creatine, omega oils, collagen, herbal, adaptogens, probiotics, electrolytes, functional foods, accessories, bundles, gift cards (simple digital-code variant).
- Multi-brand products with variants, rich labels (ingredients, NRV%), certifications, lab reports.
- Guest + registered shopping; cart; checkout with **Cash on Delivery** (card via bank POS adapter when contracted).
- Orders lifecycle, shipments, refunds; transactional email.
- Accounts: orders, addresses, wishlist, reviews, subscriptions, loyalty points, settings.
- Subscriptions as scheduled repeat orders (skip/pause/cancel), default 10% discount.
- Coupons, offers page, loyalty earn/redeem.
- Knowledge Center: articles/guides/recipes/research, ingredient library, health-goal pages, FAQs, supplement finder quiz.
- Advanced search + filtering; product compare (up to 4).
- Full admin panel: dashboard, orders, products, categories, brands, ingredients, goals, inventory & warehouses, customers, reviews, coupons, subscriptions, content, compliance queue, settings, audit log.
- i18n sq + en; SEO (metadata, JSON-LD, sitemaps); WCAG AA; Core Web Vitals targets.

**OUT of v1 (future roadmap):** third-party marketplace vendors · healthcare-professional / dietitian portals · wholesale/B2B portal · private label tooling · AI supplement coach (architecture leaves the seam: quiz answers + structured catalog) · native mobile apps · smart reminders & wearable integration · multi-currency & additional locales · multi-warehouse routing logic (schema supports multiple warehouses; v1 operates one default).

## 3. Users & roles

Roles are a single `role` enum on `profiles` (docs/03). Staff roles are assigned by an admin.

| Capability                                                                  | Guest | Customer | Support   | Product Mgr            | Content Mgr            | Warehouse Mgr         | Compliance Mgr | Admin |
| --------------------------------------------------------------------------- | ----- | -------- | --------- | ---------------------- | ---------------------- | --------------------- | -------------- | ----- |
| Browse, search, read articles, compare                                      | ✅    | ✅       | ✅        | ✅                     | ✅                     | ✅                    | ✅             | ✅    |
| Add to cart, guest checkout (COD)                                           | ✅    | ✅       | —         | —                      | —                      | —                     | —              | ✅    |
| Order lookup (number + email)                                               | ✅    | ✅       | —         | —                      | —                      | —                     | —              | ✅    |
| Account, saved addresses, wishlist, loyalty                                 | —     | ✅       | —         | —                      | —                      | —                     | —              | ✅    |
| Write reviews (verified purchase)                                           | —     | ✅       | —         | —                      | —                      | —                     | —              | ✅    |
| Manage own subscriptions                                                    | —     | ✅       | —         | —                      | —                      | —                     | —              | ✅    |
| View customers & orders; update order status; refunds; reply to inquiries   | —     | —        | ✅        | —                      | —                      | ✅ (orders/ship only) | —              | ✅    |
| Manage products, variants, categories, brands, ingredients, media, prices   | —     | —        | —         | ✅                     | —                      | —                     | —              | ✅    |
| Publish articles, pages, FAQs, banners; SEO fields; goals content           | —     | —        | —         | —                      | ✅                     | —                     | —              | ✅    |
| Stock receive/adjust, batches/expiry, shipments, packing slips, order queue | —     | —        | —         | —                      | —                      | ✅                    | —              | ✅    |
| Approve products for publish; claims/warnings; certifications; lab reports  | —     | —        | —         | —                      | —                      | —                     | ✅             | ✅    |
| Coupons & promotions                                                        | —     | —        | ✅ (view) | —                      | —                      | —                     | —              | ✅    |
| Settings, team & roles, payment/shipping config, audit log                  | —     | —        | —         | —                      | —                      | —                     | —              | ✅    |
| Delete records                                                              | —     | —        | —         | soft-delete own domain | soft-delete own domain | —                     | —              | ✅    |

Enforcement is defense-in-depth: RLS policies (docs/03 §9) + admin layout guard (docs/02 §8) + per-action role checks.

## 4. Non-functional requirements

**Performance (MUST):** LCP < 2.0 s (p75 mobile), CLS < 0.1, INP < 200 ms; Lighthouse ≥ 95 on Home/PLP/PDP; server action p95 < 300 ms (excluding external providers); first-load JS on storefront routes < 170 KB gz. Techniques: static generation + ISR for catalog/content, `next/image` everywhere, code-splitting, lazy below-the-fold, no layout shift from images/fonts.

**Security (MUST):** RLS on every table; role checks server-side; OWASP Top 10 review; security headers (CSP, HSTS, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy) via `next.config.ts`; rate limiting on auth, checkout, contact, review endpoints (docs/02 §9); Supabase Auth handles password hashing — the app never stores or logs credentials; signed URLs for private files; audit log for all admin mutations; secrets only in env vars.

**Reliability (MUST):** daily backups + PITR (Supabase), atomic checkout transaction, soft deletion for catalog/content, `order_events` + `audit_logs` history, `stock_movements` ledger, uptime monitoring + Sentry alerts. Target 99.9% uptime.

**Accessibility (MUST):** WCAG 2.1 AA; full keyboard navigation; visible focus; screen-reader labelled controls; semantic landmarks; AA contrast (checked against the token palette in docs/04); `prefers-reduced-motion` respected.

**Scalability (SHOULD):** the data model and query patterns must not require rewrites at 100k products / 1k categories / millions of customers / multiple warehouses, countries, languages, currencies. Concretely: keyset pagination on large lists, indexed filters, jsonb i18n, `currency` on every money row, `warehouse_id` on inventory, ISR instead of per-request rendering for catalog.

**Privacy/compliance (MUST):** Kosovo's Law on Personal Data Protection is GDPR-aligned — collect minimal data, cookie/analytics consent banner, privacy policy, data export/delete on request (admin procedure v1), marketing opt-in only. Supplement content rules in docs/08 §7.

## 5. Success metrics

**Technical:** 99.9% uptime · Lighthouse > 95 · LCP < 2 s · action p95 < 300 ms · zero known critical vulnerabilities.
**Business:** conversion > 3% · returning-customer rate > 40% · AOV trending up · MoM subscription growth · CSAT > 4.8/5. Instrumentation: privacy-friendly analytics + admin dashboard KPIs (docs/06 §1); a `metrics` note in docs/10 §8 covers event tracking.

## 6. Brand snapshot (full system in docs/04)

Name **BIOCODE** (from Albanian _shëndet_ — health). Personality: friendly, professional, modern, transparent, energetic, trustworthy, educational, innovative. Voice: simple, helpful, evidence-informed, never exaggerated or misleading, warm, positive, clear — in both sq and en. Visual: deep carbon green + warm white + charcoal + soft gray + accent signal; Inter / Manrope / Space Grotesk; 12–16 px radii; minimal, premium, Apple-level spacing, subtle motion.

## 7. Guiding UX principle

Every page answers one question: **"What should the user do next?"** One primary action per screen, guided naturally, never needing instructions. Education is woven into the shopping flow (ingredient chips on PDPs, goal-based navigation), not siloed.

## 8. Expansion roadmap (post-v1, for architectural awareness only)

Phase 2: card payments live (bank POS), Meilisearch, Albanian market (ALL currency, .al SEO), review Q&A. Phase 3: diaspora/EU entity + Stripe adapter, de locale, marketplace vendor onboarding, wholesale portal. Phase 4: AI supplement coach (LLM over quiz + catalog + articles), mobile apps, professional portal. Nothing in v1 may block these; anything that would must be raised before implementation.
