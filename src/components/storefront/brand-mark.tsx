import { cn } from '@/lib/utils';

/**
 * The BIOCODE lockup: the Vitality Ring plus the wordmark.
 *
 * **The geometry is the brand kit's, not an approximation.** These two arc paths are lifted
 * verbatim from `public/brand/biocode-mark.svg` — same 100-unit radius, same 26-unit stroke, same
 * sweep angles. A hand-redrawn navbar version is how a logo ends up subtly different in the one
 * place every visitor sees it, and nobody notices until it is next to the real file.
 *
 * The concept (brand kit `USAGE.md`): a near-complete forest ring whose lime segment is the last
 * piece snapping into place — the daily dose completing the routine. The same ring is the loading
 * spinner and the PDP rating arc (docs/04 §2), so the logo and the interface share one signature.
 *
 * **Static.** docs/04 §2 forbids animating the mark in the navbar; `VitalityRing` is the animated
 * one. The wordmark is Space Grotesk Medium via `font-display`, which the kit specifies and the
 * site already loads — no new font licence.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg width="28" height="28" viewBox="0 0 254 254" aria-hidden="true" className="shrink-0">
        <g transform="translate(127 127)" fill="none" strokeLinecap="round" strokeWidth="26">
          <path d="M99.03 -13.92 A100 100 0 1 1 30.90 -95.11" stroke="var(--color-forest-800)" />
          <path d="M65.61 -75.47 A100 100 0 0 1 85.72 -51.50" stroke="var(--color-lime-500)" />
        </g>
      </svg>

      {/*
        Space Grotesk **Medium** (500) at the font's **natural** tracking, and both halves were
        measured off the kit rather than eyeballed: the letter origins in
        `biocode-logo-primary.svg` sit ~67 units apart at a 100-unit em, which is Space Grotesk's
        own advance width. The wordmark is not tracked out, so neither is this.

        `text-forest-900` is `#123227` — the kit's wordmark colour, distinct from the `forest-800`
        of the ring beside it. They are deliberately two different greens.
      */}
      <span className="font-display text-xl leading-none font-medium text-forest-900">BIOCODE</span>
    </span>
  );
}
