# 04 · Design System

The brief pins the direction: **minimal, premium, warm, trustworthy wellness** — deep forest green, warm white, charcoal, soft gray, accent lime; Inter/Manrope/Space Grotesk; 12–16 px radii; Apple-level spacing; subtle motion; zero clutter. Execute that direction with precision; spend boldness in exactly one place (§2 signature). Nothing here is decorative — every device encodes information.

## 1. Design tenets

1. One primary action per screen; the lime accent is reserved for it (and for "live/health" signals). If lime appears twice in a viewport, something is wrong.
2. Whitespace is the luxury cue: generous section padding (96–128 px desktop, 56–72 px mobile), max content width 1240 px, 12-col grid, 24 px gutters.
3. Photography does the selling (clean product shots on warm-white); UI stays quiet: hairline borders (`1px` at 8–10% charcoal), soft shadows, no gradients except the token gradient in §2.
4. Education is a first-class UI citizen: ingredient chips, evidence badges, NRV tables get real design attention, not footnote styling.
5. Trust microcopy near money: delivery estimate, COD note, return policy line — always visible at the point of decision.

## 2. Signature element — the "Vitality Ring"

BIOCODE's one memorable device: a thin **lime arc/ring** motif derived from a progress ring — health, completeness, daily routine. Usage (only these): loading spinner; rating ring on PDP (rating rendered as arc fill around the score); "routine completeness" ring in the finder results and subscription card; favicon/logo mark backdrop. It animates by drawing in (400 ms, ease-out-quint) on first appearance. Everywhere else, restraint.

**The kit is the source of truth.** `public/brand/` holds the five official SVGs and `USAGE.md`; the clear-space, minimum-size and never-recolour rules live there, not here. Two components implement the motif and the split matters:

| Component                              | Role           | Geometry                                                                      |
| -------------------------------------- | -------------- | ----------------------------------------------------------------------------- |
| `components/storefront/brand-mark.tsx` | the **logo**   | Fixed. Arc paths copied verbatim from `biocode-mark.svg`. Never animated      |
| `components/shared/vitality-ring.tsx`  | the instrument | Parameterised — the gap encodes a rating or a completeness. Draws in on mount |

Redrawing the logo's ring "close enough" with two `<circle>` elements is the failure mode this table exists to prevent (docs/13 §R5): it renders about right, it is not the mark, and the browser tab is the one place a mark must be exact.

## 3. Color tokens (Tailwind v4 `@theme` in `styles/globals.css`)

| Token                | Hex                                                                                            | Use                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `--color-forest-950` | `#0B241B`                                                                                      | footer bg, darkest text on lime                                          |
| `--color-forest-900` | `#123227`                                                                                      | headings on light, dark sections                                         |
| `--color-forest-800` | `#1C4636`                                                                                      | **primary buttons**, links hover                                         |
| `--color-forest-700` | `#245741`                                                                                      | links, active nav                                                        |
| `--color-forest-600` | `#2E6B50`                                                                                      | hover fills                                                              |
| `--color-forest-500` | `#3B8465`                                                                                      | icons, secondary accents                                                 |
| `--color-forest-100` | `#DCEEE4`                                                                                      | tint backgrounds, selected chips                                         |
| `--color-forest-50`  | `#F0F7F3`                                                                                      | section tint bg                                                          |
| `--color-lime-500`   | `#A3E635`                                                                                      | **accent**: primary CTA hover ring, vitality ring, badges "New/In stock" |
| `--color-lime-400`   | `#BEF264`                                                                                      | accent tint                                                              |
| `--color-lime-950`   | `#1A2E05`                                                                                      | text on lime fills (AA)                                                  |
| `--color-cream`      | `#FAF9F5`                                                                                      | page background (warm white)                                             |
| `--color-surface`    | `#FFFFFF`                                                                                      | cards                                                                    |
| `--color-ink-900`    | `#1B1E1C`                                                                                      | body text (charcoal)                                                     |
| `--color-ink-600`    | `#565E59`                                                                                      | secondary text                                                           |
| `--color-ink-400`    | `#8B948E`                                                                                      | placeholders, meta                                                       |
| `--color-line`       | `#E6E8E4`                                                                                      | borders, dividers (soft gray)                                            |
| `--color-success`    | `#2E7D4F` · `--color-warning` `#B45309` · `--color-error` `#B3261E` · `--color-info` `#1D4ED8` | semantic                                                                 |

Contrast rules (AA verified): body `ink-900` on `cream`; buttons white on `forest-800`; text on lime uses `lime-950`; never lime text on white. Dark mode: **out of scope v1**.

## 4. Typography (`next/font`, self-hosted, `display: swap`)

| Role                           | Face                                                  | Sizes (desktop / mobile) |
| ------------------------------ | ----------------------------------------------------- | ------------------------ |
| Display (hero, section titles) | **Space Grotesk** 500/600, tracking −1%               | 56/40, 40/32             |
| Headings h2–h4                 | Space Grotesk 500                                     | 32/26, 24/20, 20/18      |
| Body                           | **Inter** 400/500, line-height 1.6                    | 16, small 14             |
| UI/labels/eyebrows             | **Manrope** 600, tracking +4%, uppercase for eyebrows | 13/12                    |
| Data (prices, NRV tables)      | Inter 600, `font-variant-numeric: tabular-nums`       | 18–24 price              |

Prices: `formatPrice(cents, locale)` → sq: `9,90 €` · en: `€9.90`. Never mix formats.

## 5. Shape, elevation, spacing

Radii: `--radius-sm: 8px` (inputs, chips) · `--radius-md: 12px` (buttons) · `--radius-lg: 16px` (cards) · `--radius-xl: 24px` (hero media, modals). Shadows: `sm 0 1px 2px rgb(20 30 25 / .06)` · `md 0 6px 20px rgb(20 30 25 / .08)` (cards hover) · `lg 0 16px 40px rgb(20 30 25 / .12)` (modals, drawer). Spacing scale = Tailwind default; section rhythm `py-24 lg:py-32`.

## 6. Core components (build on shadcn/ui, restyled to tokens)

- **Button:** primary (forest-800 bg, white text, hover forest-700 + 2px lime focus ring), secondary (white, 1px line border, ink-900), ghost, destructive; sizes sm 36 / md 44 / lg 52 px; loading state swaps label for vitality spinner; full-width on mobile forms.
- **ProductCard:** surface card, radius-lg, image ratio 1:1 on cream tile; brand eyebrow (Manrope caps, ink-400) → name (2-line clamp) → rating stars + count → price row (price + struck compare-at) → hover reveals "Shto në shportë / Add to cart" button sliding up (desktop) / persistent icon button (mobile); badges top-left: `New` (lime), `-20%` (forest-800), `Out of stock` (ink-400 overlay).
- **PriceTag**, **RatingStars** (+ ring variant on PDP), **QuantityStepper** (44 px touch targets), **VariantSelector** (segmented pills; unavailable = dashed border + strike), **SubscribeToggle** (radio cards: "One-time" vs "Subscribe & save 10%" with frequency select), **Badge** set, **Chip** (filter chips, ingredient chips — tappable, forest-100 selected), **IngredientTable** (label-style table: ingredient | per serving | %NRV; footnote row), **EvidenceBadge** (strong/moderate/emerging/traditional with tooltip), **Breadcrumbs**, **EmptyState** (icon, one sentence, one action), **StatCard** (admin), **StatusBadge** (order/payment statuses → semantic colors), **DataTable** (admin: sort, filter, keyset pagination, row actions), **Stepper** (checkout), **Accordion**, **Tabs**, **Toast** (bottom-center mobile), **Drawer** (cart), **Dialog**, **Skeletons** (§9).
- **Navbar:** cream, hairline bottom border, logo left; center nav (Shop ▾ mega, Health Goals ▾, Ingredients, Brands, Knowledge, Offers); right: search icon (expands to command-style overlay), account, cart with count badge (lime dot). Sticky; collapses to logo + search + cart + hamburger (full-screen sheet menu) ≤ 1024 px. Announcement bar slot above (banners `announcement`).
- **MegaMenu (Shop):** 4 columns of category links with small icons + a promo card (banner-driven); keyboard navigable; closes on `Esc`.
- **Footer:** forest-950, cream text; columns: Shop, Health Goals, Knowledge, Company, Help; newsletter input; payment/delivery badges (COD, bank card when live); legal row.

## 7. Iconography & imagery

lucide-react, 1.5 px stroke, 20/24 px. Product photos: white or cream background, consistent padding, min 1200×1200, WebP. Category/goal illustrations: simple line style in forest-500 on forest-50 tiles (no stock-photo collages). Never stretch or crop labels illegibly.

## 8. Motion (Framer Motion; respect `prefers-reduced-motion` — fall back to opacity only)

Durations 150 (micro) / 250 (UI) / 400 ms (page-level); easing `cubic-bezier(0.16, 1, 0.3, 1)`. Standard variants in `lib/motion.ts`: `fadeUp` (12 px), `stagger(0.06)` for card grids, drawer slide, mega-menu fade-scale (0.98→1). One orchestrated moment: home hero — headline fadeUp, product image fadeUp +80 ms, vitality ring draws. No scroll-jacking, no parallax, no continuous ambient animation.

## 9. States (mandatory everywhere)

- **Loading:** skeletons mirroring final layout (card grid = 8 skeleton cards; PDP = gallery + text blocks); never spinners for full pages; buttons show inline spinner.
- **Empty:** icon + one plain sentence + one action ("Your cart is empty" → "Browse bestsellers"). Search empty state suggests popular categories + spelling hint.
- **Error:** friendly, specific, retry action; forms show field-level messages (error color, 13 px, below input) + summary for screen readers; never raw error strings.
- **Success:** toast ≤ 3 s or inline confirmation; checkout success is a full page (docs/05 §12).

## 10. Accessibility specifics

Focus ring: 2 px lime-500 outline + 2 px offset on all interactives. Hit areas ≥ 44 px. Form inputs always labelled (no placeholder-as-label). Landmarks: `header/nav/main/footer`; skip-link first tab stop. Images: meaningful alt from `alt` jsonb (locale-aware); decorative `alt=""`. Announce cart updates and toast via `aria-live="polite"`. Color never sole meaning carrier (badges include text).

## 11. Copy rules (both locales)

Sentence case; verbs on buttons state the outcome ("Vazhdo te pagesa / Continue to payment", not "Submit"); consistent verb through a flow (Add → Added). Errors say what happened and how to fix it; no apologies, no vagueness. Empty states invite action. No exaggerated health claims ever (docs/08 §7). Tone: warm, plain, evidence-informed — Albanian copy is written natively, not translated word-for-word.
