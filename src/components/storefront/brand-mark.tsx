import { cn } from '@/lib/utils';

/**
 * The wordmark with the Vitality Ring as its backdrop (docs/04 §2 — one of the four
 * permitted uses of the motif). Static SVG: it must not animate in the navbar.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" className="shrink-0">
        <circle
          cx="14"
          cy="14"
          r="12"
          fill="none"
          stroke="var(--color-forest-100)"
          strokeWidth="3"
        />
        <circle
          cx="14"
          cy="14"
          r="12"
          fill="none"
          stroke="var(--color-lime-500)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="75.4"
          strokeDashoffset="26.4"
          transform="rotate(-90 14 14)"
        />
        <circle cx="14" cy="14" r="5" fill="var(--color-forest-800)" />
      </svg>
      <span className="font-display text-xl leading-none font-semibold tracking-tight text-forest-900">
        SHNETA
      </span>
    </span>
  );
}
