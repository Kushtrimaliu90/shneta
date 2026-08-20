import { getTranslations } from 'next-intl/server';
import { PackageSearch } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { ProductCard } from '@/components/storefront/product-card';
import { EmptyState } from '@/components/shared/empty-state';
import { buttonVariants } from '@/components/ui/button';
import type { ProductListResult } from '@/features/catalog/types';
import { cn } from '@/lib/utils';

/**
 * docs/05 §2 — a responsive card grid, 2 columns on mobile, with the zero-result state suggesting
 * how to widen the search rather than just reporting failure (docs/04 §9).
 *
 * The column count used to be a frozen `lg:grid-cols-4`, which is how the catalogue ended up showing
 * four 280px cards on a 1440px laptop *and* four 280px cards on a 2560px monitor. It is a prop now
 * because this component renders in two materially different track widths — full-bleed on search and
 * offers, and `content − 240px facet rail − 48px gap` on the catalogue — and one ladder cannot serve
 * both without either stretching the cards or starving them. See the call in `plp.tsx`.
 */
export async function ProductGrid({
  result,
  hasFilters,
  clearHref,
  columns = 'lg:grid-cols-4 xl:grid-cols-5 3xl:grid-cols-6',
}: {
  result: ProductListResult;
  hasFilters: boolean;
  clearHref: string;
  /** Tailwind column classes from `lg` up. The default is the full-width track. */
  columns?: string;
}) {
  const t = await getTranslations();

  if (result.items.length === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title={t('shop.empty.title')}
        body={hasFilters ? t('shop.empty.withFilters') : t('shop.empty.noProducts')}
        action={
          hasFilters ? (
            <Link href={clearHref} className={buttonVariants({ variant: 'secondary' })}>
              {t('shop.clearFilters')}
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <ol className={cn('grid grid-cols-2 gap-4 lg:gap-6', columns)}>
      {result.items.map((product, index) => (
        <li key={product.id} className="flex">
          {/* The first four are above the fold on desktop and drive LCP (docs/09 §3). */}
          <ProductCard product={product} priority={index < 4} className="w-full" />
        </li>
      ))}
    </ol>
  );
}
