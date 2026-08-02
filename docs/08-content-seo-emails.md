# 08 · Content, i18n, SEO & Email

## 1. i18n implementation

- next-intl; locales `['sq','en']`, `defaultLocale 'sq'`, `localePrefix: 'as-needed'` (sq unprefixed, `/en/...`). Locale switcher preserves the current path; user preference saved to profile when authed.
- **UI strings:** `src/i18n/messages/{sq,en}.json`, nested by feature (`cart.addToCart`). Both files updated in the same commit — CI fails on key mismatch (script `check:i18n`). ICU plurals for counts.
- **DB content:** jsonb per-locale. Helper `pickLocale(field, locale)` returns `field[locale] ?? field.sq ?? ''`; `/en` pages render sq fallback with a subtle "Albanian only" note for long-form bodies only.
- Albanian is written natively (never machine-translated verbatim); ë/ç handled everywhere (search uses unaccent). Number/date formatting via `Intl` per locale; currency per docs/04 §4.

## 2. Knowledge Center editorial model

Types: **guide** (evergreen how-to, e.g. "Si të zgjedhësh proteinën e duhur"), **article** (topical), **recipe** (functional-food recipes with linked products), **research** (plain-language study summaries; must cite source links), **news**. Workflow: draft → in_review → published (content_manager publishes; research pieces SHOULD get compliance eyes). Every piece: cover (1200×675), excerpt ≤ 160 chars, tags, ≥1 related product or ingredient (drives "Shop this article"), reading time auto-computed (words/200). Cadence target: 2/week post-launch (operational, not system).

## 3. Content bodies

Markdown stored per-locale in jsonb; rendered with react-markdown + remark-gfm + rehype-sanitize (allowlist: headings, p, lists, tables, blockquote, img, a, strong/em, hr). Images uploaded to `content` bucket and referenced by public URL; external links `rel="noopener nofollow"` by default, internal links relative. No raw HTML.

## 4. SEO

- **Metadata:** `generateMetadata` everywhere; title pattern `{Page} | BIOCODE` (home: `BIOCODE — Suplemente dhe Wellness në Kosovë`); descriptions from `seo` jsonb with sensible fallbacks; canonical absolute; `alternates.languages` hreflang sq/en + `x-default` → sq.
- **JSON-LD:** Organization + WebSite/SearchAction (home); Product (+Offer availability from stock, +AggregateRating when count>0) and BreadcrumbList (PDP); ItemList (PLP/brand/goal); Article (knowledge); FAQPage (/faq). Helper `lib/seo.ts` builds all — no ad-hoc schema in pages.
- **Sitemaps:** `app/sitemap.ts` → index of segmented maps (static, categories, products, brands, goals, ingredients, articles) with `lastModified` from `updated_at`; robots allows all except `/admin`, `/account`, `/checkout`, `/cart`, `/api`.
- **URLs:** stable, lowercase, hyphenated, slug immutability post-publish; archived product = friendly gone page (docs/07 §10) keeping status 410 semantics (Next: render page + `robots: noindex`).
- **OG:** product/article images as OG; default brand OG card for the rest. Not-indexed: search, compare, finder results, account, checkout.

## 5. Newsletter

Footer + home block → `subscribeNewsletter` (rate-limited, honeypot) → row + **double opt-in** email with confirm link (signed token → sets `confirmed_at`) → welcome email with `WELCOME10` mention. Unsubscribe link (signed) in every marketing email sets `unsubscribed_at`. v1 sends only transactional + the welcome; campaign tooling is external/future — the table is the export source.

## 6. Transactional email (Resend + react-email)

Shared layout: logo, carbon header rule, content, footer (contact, address, unsubscribe where applicable). All bilingual — template renders in `order.locale` / `profile.preferred_locale`. From: `BIOCODE <porosite@biocode.com>` (env `EMAIL_FROM`; verify domain, SPF/DKIM per docs/10). Every send via `lib/email/send.ts` → logs to `email_log`.

| Template                                            | Trigger                                      | Key content                                                                            |
| --------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| order-confirmation                                  | checkout success (COD) / webhook paid (card) | number, items, totals incl. VAT line, COD amount to prepare, address, ETA, lookup link |
| order-confirmed                                     | status → confirmed                           | "being prepared"                                                                       |
| order-shipped                                       | shipment created                             | carrier, tracking link, ETA                                                            |
| order-delivered                                     | status → delivered                           | thanks + loyalty points earned                                                         |
| order-cancelled / refund-issued                     | events                                       | reason-safe copy, refund method                                                        |
| payment-failed                                      | webhook failed                               | retry link (24 h)                                                                      |
| subscription-upcoming                               | cron T−3                                     | items, date, skip/pause one-click links                                                |
| subscription-created / paused / resumed / cancelled | actions/cron                                 | state confirmation                                                                     |
| review-request                                      | delivered +7 d cron                          | deep links to review purchased items                                                   |
| guest-account-invite                                | opt-in at checkout                           | set-password link                                                                      |
| newsletter-confirm / newsletter-welcome             | opt-in flow                                  | confirm link / welcome + code                                                          |
| contact-ack                                         | contact form                                 | "we received it"                                                                       |

Supabase auth emails (verify, reset) restyled with the same header/footer in the Supabase dashboard templates.

## 7. Compliance & claims rules (MUST — bake into editor guidance and all copy)

Food-supplement rules (EU-aligned, applicable in Kosovo practice):

1. Never state or imply a product **treats, cures, prevents, or diagnoses** disease. Banned verb list surfaced in admin editors: cures, treats, heals, prevents [disease], anti-cancer, fights infection…
2. Permissible: general function/wellbeing claims consistent with recognized ingredient functions ("Vitamin C contributes to the normal function of the immune system") — prefer EFSA-style wording; EvidenceBadge reflects honest evidence level.
3. Mandatory site-wide disclaimer (footer of PDP ingredients tab, ingredient pages, knowledge pages, finder results): _"Suplementet ushqimore nuk zëvendësojnë një dietë të balancuar dhe një mënyrë jetese të shëndetshme. / Food supplements are not a substitute for a balanced diet and a healthy lifestyle."_ plus "Consult a healthcare professional if pregnant, nursing, taking medication, or under 18" on relevant categories.
4. Warnings field renders prominently (docs/05 §3); allergen names bolded.
5. Finder results and AI-adjacent features carry "educational, not medical advice" copy.
6. Compliance manager approval gates publishing (docs/07 §10); lab reports substantiate quality claims.
