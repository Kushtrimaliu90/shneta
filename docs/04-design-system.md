# 04 · Design System

The brief pins the direction: **minimal, premium, warm, trustworthy wellness** — deep carbon green, warm white, charcoal, soft gray, accent signal; Inter/Manrope/Space Grotesk; 12–16 px radii; Apple-level spacing; subtle motion; zero clutter. Execute that direction with precision; spend boldness in exactly one place (§2 signature). Nothing here is decorative — every device encodes information.

## 1. Design tenets

1. One primary action per screen; the signal accent is reserved for it (and for "live/health" signals). If signal appears twice in a viewport, something is wrong.
2. Whitespace is the luxury cue: generous section padding (96–128 px desktop, 56–72 px mobile), max content width 1240 px, 12-col grid, 24 px gutters.
3. Photography does the selling (clean product shots on warm-white); UI stays quiet: hairline borders (`1px` at 8–10% charcoal), soft shadows, no gradients except the token gradient in §2.
4. Education is a first-class UI citizen: ingredient chips, evidence badges, NRV tables get real design attention, not footnote styling.
5. Trust microcopy near money: delivery estimate, COD note, return policy line — always visible at the point of decision.

## 2. Signature element — the "Signal Ring"

BIOCODE's one memorable device: a thin **arc/ring** read as an instrument reading — a value
resolving toward its target. Usage (only these): loading spinner; rating ring on PDP (rating
rendered as arc fill around the score); "routine completeness" ring in the finder results and
subscription card. It animates by drawing in (400 ms, ease-out-quint) on first appearance.
Everywhere else, restraint.

**The logo does not use it.** The mark is a separate device — four bars of unequal height on a
carbon tile, a readout rather than a ring — because a mark has to survive at 16 px in a browser
tab, and a 3 px stroke on a circle does not. See `components/storefront/brand-mark.tsx`.

## 3. Color tokens (Tailwind v4 `@theme` in `styles/globals.css`)

| Token                 | Hex                                                                                            | Use                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `--color-carbon-950`  | `#060B10`                                                                                      | footer ground, darkest surface                                             |
| `--color-carbon-900`  | `#0D1620`                                                                                      | headings on light, the logo tile                                           |
| `--color-carbon-800`  | `#16232F`                                                                                      | **primary buttons**, link hover                                            |
| `--color-carbon-700`  | `#1F3040`                                                                                      | links, active nav, the focus ring                                          |
| `--color-carbon-600`  | `#2C4257`                                                                                      | text on tints, placeholders (9.29:1 on `carbon-50`)                        |
| `--color-carbon-500`  | `#607A96`                                                                                      | **graphics only** — 3.98:1 on `carbon-50`: passes SC 1.4.11, fails AA text |
| `--color-carbon-100`  | `#DCE4EB`                                                                                      | selected chips, active filter tabs                                         |
| `--color-carbon-50`   | `#EEF3F7`                                                                                      | section tint, selected cards                                               |
| `--color-signal-500`  | `#2EE6C5`                                                                                      | **accent**: the ring, badges, the mark. A fill, never text on light        |
| `--color-signal-400`  | `#7CF2DC`                                                                                      | accent tint, the outer focus ring                                          |
| `--color-signal-950`  | `#04231D`                                                                                      | text on signal fills (10.48:1)                                             |
| `--color-bone`        | `#F7F9FA`                                                                                      | page background (cool paper)                                               |
| `--color-surface`     | `#FFFFFF`                                                                                      | cards                                                                      |
| `--color-ink-900`     | `#12181D`                                                                                      | body text                                                                  |
| `--color-ink-600`     | `#4F5960`                                                                                      | secondary text — **and all text on a tint** (docs/13 §Q4)                  |
| `--color-ink-500`     | `#68737B`                                                                                      | eyebrows, meta, helper text on `bone` or `surface` only                    |
| `--color-ink-400`     | `#98A2A9`                                                                                      | decorative and disabled only — 2.46:1, cannot carry text                   |
| `--color-line`        | `#E3E8EC`                                                                                      | decorative dividers (1.17:1 — never a control boundary)                    |
| `--color-line-strong` | `#737F87`                                                                                      | control boundaries: inputs, checkboxes, radios (3.89:1)                    |
| `--color-success`     | `#0E7C5A` · `--color-warning` `#B45309` · `--color-error` `#B3261E` · `--color-info` `#1D4ED8` | semantic                                                                   |

Contrast rules are **not** documented here and hoped for — they are asserted in
`tests/unit/contrast.test.ts`, which reads these exact values out of `globals.css` and fails the
build on a regression. Thirty-two assertions, including the three that are deliberately
_negative_ (`ink-400`, `ink-500`-on-a-tint, signal-on-white) so nobody widens where they may be
used without also changing the rule. Dark mode: **out of scope v1**.

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

- **Button:** primary (carbon-800 bg, white text, hover carbon-700 + 2px signal focus ring), secondary (white, 1px line border, ink-900), ghost, destructive; sizes sm 36 / md 44 / lg 52 px; loading state swaps label for signal spinner; full-width on mobile forms.
- **ProductCard:** surface card, radius-lg, image ratio 1:1 on bone tile; brand eyebrow (Manrope caps, ink-400) → name (2-line clamp) → rating stars + count → price row (price + struck compare-at) → hover reveals "Shto në shportë / Add to cart" button sliding up (desktop) / persistent icon button (mobile); badges top-left: `New` (signal), `-20%` (carbon-800), `Out of stock` (ink-400 overlay).
- **PriceTag**, **RatingStars** (+ ring variant on PDP), **QuantityStepper** (44 px touch targets), **VariantSelector** (segmented pills; unavailable = dashed border + strike), **SubscribeToggle** (radio cards: "One-time" vs "Subscribe & save 10%" with frequency select), **Badge** set, **Chip** (filter chips, ingredient chips — tappable, carbon-100 selected), **IngredientTable** (label-style table: ingredient | per serving | %NRV; footnote row), **EvidenceBadge** (strong/moderate/emerging/traditional with tooltip), **Breadcrumbs**, **EmptyState** (icon, one sentence, one action), **StatCard** (admin), **StatusBadge** (order/payment statuses → semantic colors), **DataTable** (admin: sort, filter, keyset pagination, row actions), **Stepper** (checkout), **Accordion**, **Tabs**, **Toast** (bottom-center mobile), **Drawer** (cart), **Dialog**, **Skeletons** (§9).
- **Navbar:** bone, hairline bottom border, logo left; center nav (Shop ▾ mega, Health Goals ▾, Ingredients, Brands, Knowledge, Offers); right: search icon (expands to command-style overlay), account, cart with count badge (signal dot). Sticky; collapses to logo + search + cart + hamburger (full-screen sheet menu) ≤ 1024 px. Announcement bar slot above (banners `announcement`).
- **MegaMenu (Shop):** 4 columns of category links with small icons + a promo card (banner-driven); keyboard navigable; closes on `Esc`.
- **Footer:** carbon-950, bone text; columns: Shop, Health Goals, Knowledge, Company, Help; newsletter input; payment/delivery badges (COD, bank card when live); legal row.

## 7. Iconography & imagery

lucide-react, 1.5 px stroke, 20/24 px. Product photos: white or bone background, consistent padding, min 1200×1200, WebP. Category/goal illustrations: simple line style in carbon-500 on carbon-50 tiles (no stock-photo collages). Never stretch or crop labels illegibly.

## 8. Motion (Framer Motion; respect `prefers-reduced-motion` — fall back to opacity only)

Durations 150 (micro) / 250 (UI) / 400 ms (page-level); easing `cubic-bezier(0.16, 1, 0.3, 1)`. Standard variants in `lib/motion.ts`: `fadeUp` (12 px), `stagger(0.06)` for card grids, drawer slide, mega-menu fade-scale (0.98→1). One orchestrated moment: home hero — headline fadeUp, product image fadeUp +80 ms, signal ring draws. No scroll-jacking, no parallax, no continuous ambient animation.

## 9. States (mandatory everywhere)

- **Loading:** skeletons mirroring final layout (card grid = 8 skeleton cards; PDP = gallery + text blocks); never spinners for full pages; buttons show inline spinner.
- **Empty:** icon + one plain sentence + one action ("Your cart is empty" → "Browse bestsellers"). Search empty state suggests popular categories + spelling hint.
- **Error:** friendly, specific, retry action; forms show field-level messages (error color, 13 px, below input) + summary for screen readers; never raw error strings.
- **Success:** toast ≤ 3 s or inline confirmation; checkout success is a full page (docs/05 §12).

## 10. Accessibility specifics

Focus ring: 2 px signal-500 outline + 2 px offset on all interactives. Hit areas ≥ 44 px. Form inputs always labelled (no placeholder-as-label). Landmarks: `header/nav/main/footer`; skip-link first tab stop. Images: meaningful alt from `alt` jsonb (locale-aware); decorative `alt=""`. Announce cart updates and toast via `aria-live="polite"`. Color never sole meaning carrier (badges include text).

## 11. Copy rules (both locales)

Sentence case; verbs on buttons state the outcome ("Vazhdo te pagesa / Continue to payment", not "Submit"); consistent verb through a flow (Add → Added). Errors say what happened and how to fix it; no apologies, no vagueness. Empty states invite action. No exaggerated health claims ever (docs/08 §7). Tone: warm, plain, evidence-informed — Albanian copy is written natively, not translated word-for-word.
