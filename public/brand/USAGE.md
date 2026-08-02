# BioCode identity v1 — usage

Concept: **the Vitality Ring.** A near-complete forest ring; the lime segment is the final piece
snapping in — your daily dose completing the routine. The same ring is the product's loading
spinner and PDP rating ring (docs/04 §2), so the logo and the interface share one signature.

## Files

| File                       | Use                                                |
| -------------------------- | -------------------------------------------------- |
| `biocode-logo-primary.svg` | Default horizontal lockup, light backgrounds       |
| `biocode-logo-reverse.svg` | Cream/lime version for forest or photo backgrounds |
| `biocode-logo-stacked.svg` | Square-ish lockup (social avatars, packaging)      |
| `biocode-mark.svg`         | Ring alone (favicon source, watermark)             |
| `biocode-app-icon.svg`     | 512 rounded tile (PWA / app stores)                |

## Rules

- **Clear space** around any lockup: the cap height of the B on all sides.
- **Min sizes:** primary lockup 120 px wide; mark 24 px (below that the gaps close — acceptable).
- **Colours:** forest `#1C4636` (mark), `#123227` (wordmark), lime `#A3E635`, cream `#FAF9F5`,
  deep panel `#0B241B`. Never recolour the lime segment, never rotate the ring, no shadows,
  gradients or outlines.
- **Reverse** version only on forest-900/950 or dark photography with a scrim.
- **Wordmark face:** Space Grotesk Medium (SIL Open Font Licence) — already the site's display
  font, so no new font licence.

## Where this lives in the code

The kit is the source of truth; the app must not diverge from it.

- `src/components/storefront/brand-mark.tsx` — the header lockup. Its two arc paths are **copied
  verbatim** from `biocode-mark.svg`: same 100-unit radius, same 26-unit stroke, same sweep. A
  hand-redrawn navbar mark is how a logo ends up subtly wrong in the one place everybody sees it.
- `src/app/icon.svg`, `src/app/apple-icon.svg` — favicon and app icon, both the 512 tile.
- `src/components/shared/vitality-ring.tsx` — the _functional_ ring: rating arcs, routine
  completeness, the spinner. Parameterised by value, so its gap moves; the logo's does not.
- `src/styles/globals.css` — the palette above, as tokens. `tests/unit/contrast.test.ts` reads
  those tokens and asserts the AA floors, so a colour change that breaks legibility fails the
  build rather than shipping.
