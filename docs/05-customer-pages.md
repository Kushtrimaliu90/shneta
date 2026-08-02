# 05 · Customer Pages

Format per page: **Route · Access · Rendering · Sections · Data · Actions · SEO · Acceptance.** Global: every page uses the design system (docs/04), is bilingual, ships loading/empty/error states, and answers "what should the user do next?". Rendering modes per docs/02 §5. All prices VAT-inclusive with delivery estimate near CTAs.

## 1. Home — `/`

Static+ISR. Sections in order:

1. **Announcement bar** (banner `announcement`, dismissible per session).
2. **Hero** (banner `home_hero`): Space Grotesk headline ("Biologjia jote ka një kod." / "Your biology has a code." — docs/01 §brand), subline, primary CTA → `/shop`, secondary → `/finder`; product visual right; vitality ring draw-in.
3. **Trust strip:** 4 items — free delivery over threshold (from settings), COD available, authentic brands, easy returns.
4. **Shop by goal:** 8 goal tiles (icon, name) → `/goals/[slug]`, "All goals" link.
5. **Bestsellers:** 8 ProductCards (query: published, ordered by 90-day sales count with fallback `is_featured`), carousel on mobile.
6. **Category showcase:** 6 primary categories with imagery.
7. **Subscribe & save explainer:** 3 steps + CTA.
8. **From the Knowledge Center:** 3 latest published articles.
9. **Featured brands** logo row.
10. **Newsletter** block (email input → `subscribeNewsletter` action; double opt-in per docs/08 §6).
    Data: banners, goals, featured/bestseller products (+default variant, first image), latest articles, brands, settings. SEO: Organization + WebSite(SearchAction) JSON-LD. **Acceptance:** LCP element is hero text/image, < 2 s; all tiles keyboard reachable; empty CMS slots collapse gracefully.

## 2. Shop / PLP — `/shop` and `/shop/[category]`

Static+ISR for category pages, dynamic when filter/sort params present. Layout: breadcrumbs; h1 = category name + product count; **FilterSidebar** (desktop) / full-screen filter sheet with sticky "Show N products" (mobile). Filters (URL query params, shareable): subcategory, brand (multi), health goal (multi), ingredient (multi), price range slider, form, dietary tags, rating ≥ 4, in stock, on sale. Sort: relevance | newest | price ↑ | price ↓ | rating | bestselling. Grid 4/2 cols (desktop/mobile), 24 products/page, keyset pagination ("Load more" + SEO `?page=` links in noscript). Active filter chips row with clear-all. Category page adds a 1–2 sentence localized intro (`categories.description`) above grid and subcategory quick links.
Data: category tree, brands/goals/ingredients present in the current result set (facet counts), products via a single `search_products` query (docs/03 indexes). Actions: add-to-cart from card (default variant; multi-variant opens quick-add sheet), wishlist toggle. SEO: ItemList JSON-LD, canonical strips filter params except category+page. **Acceptance:** filters update URL without full reload, back button restores state; 0-result state suggests removing chips; facet counts correct.

## 3. Product detail / PDP — `/product/[slug]`

Static+ISR (`generateStaticParams` top 200). Two-column ≥1024 px, stacked mobile.
**Left:** gallery (main image + thumbs, swipe on mobile, zoom on tap/hover, badges).
**Right:** brand link eyebrow → product name (h1) → rating ring + count (anchor to reviews) → short subtitle → **price block** (variant price, compare-at struck, "incl. VAT" note) → **VariantSelector** → **SubscribeToggle** (one-time vs subscribe 10% + frequency 30/45/60/90) → **QuantityStepper + Add to cart** (primary; sticky bottom bar on mobile with price + CTA) → stock line ("In stock · delivery 1–3 days" / "Only 3 left" when ≤ threshold / "Out of stock" + notify-me email capture (future flag)) → trust row (COD, returns, authenticity) → wishlist + share.
**Below (tabs on desktop / accordions on mobile):** Description (markdown) · **Ingredients & label**: IngredientTable with amounts + %NRV, each ingredient chip → `/ingredients/[slug]`, EvidenceBadge, allergen/warnings block (from `warnings`, visually distinct) · How to use · **Certifications & quality**: cert badges + public lab reports (signed-URL PDF links) · **Reviews**: summary (avg ring, distribution bars), filter by stars, verified badge, helpful vote, "Write a review" (auth + purchased → dialog; else explains why) · Q&A (v2 placeholder hidden).
**Then:** "Frequently bought together" (relations), "Similar products" (same primary category), "Learn more" (linked articles).
Data: product + variants + images + ingredients(join) + goals + certs + lab reports(public) + approved reviews(paginated) + relations + articles. Actions: `addToCart`, `toggleWishlist`, `createReview`, `voteReviewHelpful`, `startSubscriptionFromPdp` (adds as subscription line in checkout context v1: creates/updates draft subscription after first order — see docs/07 §8.2). SEO: Product JSON-LD (offers: price, currency EUR, availability; aggregateRating when count>0), BreadcrumbList; OG image = first product image. **Acceptance:** variant switch updates price/SKU/stock/URL hash without reload; out-of-stock variant not addable; reviews paginate; all label data renders from DB (no hardcoding); Lighthouse ≥ 95.

## 4. Brands — `/brands`, `/brands/[slug]`

Index: alphabet-grouped logo grid + search-as-you-type filter. Detail: brand banner, logo, localized description, country, PLP grid of its products (reuses §2 machinery scoped to brand). SEO: Brand→ItemList. **Acceptance:** empty brand shows friendly state.

## 5. Health goals — `/goals`, `/goals/[slug]`

Index: 16 goal tiles. Detail: hero (name, tagline, image), "How to approach {goal}" intro (localized description), **recommended products** (products joined to goal, sorted rating/bestselling), related ingredients chips, related articles. This is a key SEO landing page — unique 150+ word intros required (content team). **Acceptance:** every goal from seed renders; products section caps at 12 + "View all in shop" deep-link with goal filter preset.

## 6. Ingredients — `/ingredients`, `/ingredients/[slug]`

Index: searchable A–Z list with category filter (vitamin, mineral, herb, amino…). Detail: name + other names, EvidenceBadge, summary, benefits, dosage notes, safety notes (distinct callout), "Products containing {ingredient}" grid, related articles. Educational tone; the mandatory supplement disclaimer (docs/08 §7) in footer of page. **Acceptance:** ingredient chips across the site land here; safety notes always visible when present.

## 7. Knowledge Center — `/knowledge`, `/knowledge/[slug]`

Hub: featured article hero; tab/filter by type (Guides, Articles, Recipes, Research updates, News); tag chips; card grid (cover, type badge, title, excerpt, reading time); pagination. Article page: cover, type + date + reading time, title, author name, localized markdown body (react-markdown + sanitize; styled prose), inline related-product cards (from `article_products`) rendered as a "Shop this article" aside, related ingredient chips, related articles, share buttons, standard disclaimer footer. SEO: Article JSON-LD, OG. **Acceptance:** body renders headings/lists/images/tables correctly in both locales; missing locale body falls back to sq with a small "available in Albanian" note on /en.

## 8. Search — `/search?q=`

Dynamic. Instant overlay from navbar (client, debounced 250 ms, calls a `searchQuick` action → top 5 products + top 3 articles + "See all"); full page shows tabs Products / Articles / Ingredients with counts, product results reuse PLP grid + filters. Backed by FTS + trigram (docs/03 §8); log zero-result queries to `quiz_submissions`? — no: to a lightweight `search_log` **not** in v1; skip logging v1. **Acceptance:** typo "vitamn c" still finds Vitamin C (trigram); empty query redirects to /shop.

## 9. Compare — `/compare?ids=a,b,c,d`

Dynamic, max 4 products (add via compare toggle on cards/PDP; state in URL + cookie). Sticky product header row (image, name, price, add-to-cart), attribute rows: price/serving count, price per serving (computed), form, key ingredient amounts (union of ingredients; aligned rows; “—” when absent), dietary tags, certifications, rating. Row-diff highlight toggle. Mobile: horizontal scroll with sticky first column. **Acceptance:** shareable URL reproduces the table; removing an item updates URL.

## 10. Supplement Finder — `/finder`

Dynamic, multi-step quiz (Stepper): 1 primary goal (from health_goals) → 2 secondary goals (multi ≤ 2) → 3 lifestyle (diet: vegan/vegetarian/none; sleep quality; activity level) → 4 constraints (allergies/avoid tags, form preference, budget/month) → 5 email (optional, guests) → **Results**: "Your routine" — 3–5 products with per-product "why" line (matched goal/ingredient), routine completeness ring, total/month, add-all-to-cart, save (auth) . Matching = deterministic scoring v1: +3 primary-goal match, +1 secondary, filter out conflicting dietary tags/allergens, prefer rating & in-stock; seam left for AI coach (roadmap). Persists to `quiz_submissions`. **Acceptance:** finishing < 60 s; back navigation preserves answers; results never empty (fallback to bestsellers with notice).

## 11. Offers — `/offers`

Static+ISR: banner `offers` slots, grid of products where compare_at price set (on sale), active public coupons presented as claimable codes (copy button). **Acceptance:** expired coupons never render.

## 12. Cart & Checkout

**Cart drawer** (global): opens on add; line items (image, name, variant, qty stepper, remove, line total), subtotal, free-shipping progress bar ("Add €X for free delivery"), CTA → `/checkout`, "View cart". **Cart page** `/cart`: same + coupon field (validates via `previewCoupon` action), notes field, cross-sell row. Empty state → bestsellers.
**Checkout** `/checkout` — dynamic, single page with 4 collapsible steps (Stepper), guest-first:

1. **Contact:** email (+ "Create an account after checkout?" checkbox for guests; existing email offers sign-in inline), phone (Kosovo format validated, +383 default).
2. **Delivery:** address form (autofill from saved addresses when authed; save-to-account toggle), shipping method radio cards (name, ETA, price / "Free").
3. **Payment:** radio cards — **Cash on Delivery** (default; "Pay the courier in cash") and **Card** (only when `settings.checkout.bank_pos_enabled`; explains redirect).
4. **Review:** items, totals block (subtotal, discount w/ coupon code, shipping, "includes VAT (18%) €x.xx", **Total**), terms checkbox, **Place order** (primary, loading state).
   Right rail (desktop): persistent order summary. On submit → `placeOrder` action → RPC (docs/07 §4) → success redirect / provider redirect. Errors map to friendly messages (OUT_OF_STOCK names the item and updates cart).
   **Success** `/checkout/success/[orderNumber]`: big check, order number, ETA, COD amount to prepare, "Track with order number + email" note, account-creation nudge for guests (one-tap: sets password via emailed link), related products. **Acceptance (E2E):** full guest COD purchase; price/total manipulation impossible (server-priced); double-submit safe (button disables + RPC idempotent per cart: converted cart can't re-order).

## 13. Order lookup — `/order-lookup`

Guest form: order number + email → `lookupOrder` action (service client, rate-limited) → read-only order status view (timeline, items, totals, shipment tracking link). **Acceptance:** wrong pair returns generic "not found" (no enumeration).

## 14. Account — `/account/**` (auth required)

Shell with side nav (mobile: horizontal scroll tabs). Pages:

- **Overview:** greeting, latest order status card, active subscription card, loyalty points card (progress ring to next reward), quick links.
- **Orders:** list (number, date, items thumb-stack, total, StatusBadge) → **Order detail:** timeline (order_events sanitized to customer-safe steps), items, totals, addresses, shipment tracking, "Buy again" (adds all to cart), invoice download (v1: print-styled page), cancel button while status=pending (`requestCancelOrder`).
- **Subscriptions:** cards per subscription (items, frequency, next delivery date, price w/ discount, status) with actions: skip next, pause (with resume date), change frequency, edit items/qty, cancel (reason select). Copy states the COD model plainly.
- **Addresses:** CRUD, default shipping/billing toggles.
- **Wishlist:** product grid + add-to-cart, remove.
- **Reviews:** my reviews with status (pending/approved/rejected+reason), edit while pending.
- **Loyalty:** balance, ledger table, "Redeem 100 pts → €5 coupon" button (`redeemLoyalty` → generates single-use coupon, shows code) with terms.
- **Settings:** name, phone, locale preference, marketing opt-in, change password (Supabase), delete account request (creates support ticket via contact_messages; explains process).
  **Acceptance:** all mutations optimistic where safe, otherwise loading states; a user can never see another user's data (RLS tested).

## 15. Auth — `/auth/*`

Sign-in, sign-up (name, email, password, marketing opt-in, terms), forgot/reset, verify-email landing. Card layout, minimal, brand mark. Post-auth redirect to `next` param; cart merge runs on sign-in (docs/07 §3.3). Errors: friendly, non-enumerating ("If the email exists, we sent a link"). Rate limited (docs/02 §9).

## 16. Static & utility

`/about` (story, values, team optional — from `pages`), `/contact` (form name/email/subject/message → `submitContact`, ack email, honeypot; company info + map optional), `/faq` (accordion grouped by category, FAQPage JSON-LD), `/legal/terms`, `/legal/privacy`, `/legal/shipping-returns` (from `pages`). `not-found`: search box + popular categories. `error`: retry. Cookie-consent banner (blocks analytics until accepted; link to privacy).

## 17. Global chrome

Navbar/mega/footer per docs/04 §6; LocaleSwitcher (sq/en) preserving path; cart badge count from server on load + client sync after actions; announcement banner; skip-link.
