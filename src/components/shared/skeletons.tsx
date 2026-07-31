import { cn } from '@/lib/utils';

/**
 * docs/04 §9 — skeletons mirror the final layout so nothing shifts when content arrives;
 * full-page spinners are not used.
 *
 * Each block is `aria-hidden` and the wrapper carries a single polite live region, so a
 * screen reader hears "loading" once instead of announcing a dozen empty boxes.
 */
function Block({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-sm bg-forest-50', className)} aria-hidden="true" />
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <Block className="aspect-square rounded-none" />
      <div className="flex flex-col gap-2 p-4">
        <Block className="h-3 w-16" />
        <Block className="h-4 w-full" />
        <Block className="h-4 w-2/3" />
        <Block className="mt-2 h-5 w-20" />
      </div>
    </div>
  );
}

/** docs/04 §9 — a card grid loads as eight skeleton cards. */
export function ProductGridSkeleton({ count = 8, label }: { count?: number; label: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label}>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
        {Array.from({ length: count }, (_, index) => (
          <ProductCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

/** docs/04 §9 — the PDP loads as gallery plus text blocks. */
export function ProductDetailSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="container-page py-8">
      <div className="grid gap-10 lg:grid-cols-2">
        <Block className="aspect-square rounded-lg" />
        <div className="flex flex-col gap-4">
          <Block className="h-3 w-24" />
          <Block className="h-9 w-3/4" />
          <Block className="h-4 w-40" />
          <Block className="h-7 w-28" />
          <Block className="h-11 w-full" />
          <Block className="h-13 w-full" />
        </div>
      </div>
    </div>
  );
}
