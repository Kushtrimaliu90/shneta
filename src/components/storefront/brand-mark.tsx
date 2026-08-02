import { cn } from '@/lib/utils';

/**
 * The BIOCODE mark: a sequence tile plus the wordmark.
 *
 * **The tile.** Four bars of unequal height on a carbon ground — a readout, a genome track, a
 * barcode. It says "this is measured" without a single literal reference to a leaf, a molecule
 * or a strand of DNA, all three of which every supplement brand already owns.
 *
 * The bars are drawn, not lettered, for one practical reason: this has to survive at 16 px in a
 * browser tab and at 28 px here. Anything with interior detail turns to mud at that size, and a
 * mark you cannot use small is a mark you end up not using.
 *
 * **Static.** docs/04 §2 forbids animating the mark in the navbar. The accent does the attention
 * work; a moving logo only competes with the page.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" className="shrink-0">
        <rect width="28" height="28" rx="8" fill="var(--color-carbon-900)" />
        {/*
          Heights read low → high → mid → highest: a reading that resolves upward. Even bars
          would read as a barcode and nothing else; uneven ones read as a change over time.
        */}
        <rect x="6" y="15" width="3" height="7" rx="1.5" fill="var(--color-signal-500)" />
        <rect x="11" y="11" width="3" height="11" rx="1.5" fill="var(--color-signal-500)" />
        <rect x="16" y="13" width="3" height="9" rx="1.5" fill="var(--color-signal-400)" />
        <rect x="21" y="6" width="3" height="16" rx="1.5" fill="var(--color-signal-500)" />
      </svg>

      {/*
        Tight tracking, one weight. The name is eight characters of one word, which is the whole
        reason it works as a wordmark — it needs no lockup, no stacking and no abbreviation.
      */}
      <span className="font-display text-xl leading-none font-semibold tracking-[-0.02em] text-carbon-900">
        BIOCODE
      </span>
    </span>
  );
}
