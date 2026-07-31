import { getTranslations } from 'next-intl/server';
import { PackageSearch } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { ProductCard } from '@/components/storefront/product-card';
import { EmptyState } from '@/components/shared/empty-state';
import { buttonVariants } from '@/components/ui/button';
import type { ProductListResult } from '@/features/catalog/types';

/**
 * docs/05 §2 — 4 columns desktop, 2 mobile, with the zero-result state suggesting how to
 * widen the search rather than just reporting failure (docs/04 §9).
 */
export async function ProductGrid({
  result,
  hasFilters,
  clearHref,
}: {
  result: ProductListResult;
  hasFilters: boolean;
  clearHref: string;
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
    <ol className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
      {result.items.map((product, index) => (
        <li key={product.id} className="flex">
          {/* The first four are above the fold on desktop and drive LCP (docs/09 §3). */}
          <ProductCard product={product} priority={index < 4} className="w-full" />
        </li>
      ))}
    </ol>
  );
}
