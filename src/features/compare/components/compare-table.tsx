'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { formatPrice } from '@/lib/money';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { ProductImage } from '@/components/storefront/product-image';
import { RatingStars } from '@/components/storefront/rating-stars';
import { buttonVariants } from '@/components/ui/button';
import { useCompare } from '@/features/compare/components/compare-provider';
import type { CompareProduct } from '@/features/compare/queries';
import { cn } from '@/lib/utils';

/**
 * docs/05 §9 — the comparison table.
 *
 * A real `<table>` with the product names as column headers and the attribute names as row
 * headers, so a screen reader announces "Price, Vitamin D3, €12.90" rather than reading a grid
 * of loose numbers. That is the whole reason this is not a flex grid of cards.
 *
 * Mobile is a horizontal scroll with the first column pinned: dropping to stacked cards would
 * lose the alignment, and alignment is the only thing a comparison table is for.
 */
export function CompareTable({ products }: { products: CompareProduct[] }) {
  const t = useTranslations('compare');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { toggle } = useCompare();
  const [highlight, setHighlight] = useState(false);

  /*
   * The union of every ingredient across the selected products, in first-seen order.
   *
   * docs/05 §9 asks for aligned ingredient rows with "—" where a product does not contain one.
   * That comparison — "this one has no magnesium at all" — is most of the value, and it only
   * works if the row exists for products that lack it.
   */
  const ingredientRows = useMemo(() => {
    const seen = new Map<string, string>();
    for (const product of products) {
      for (const ingredient of product.ingredients) {
        if (!seen.has(ingredient.slug)) {
          seen.set(ingredient.slug, pickLocale(ingredient.name, locale) || ingredient.slug);
        }
      }
    }
    return [...seen.entries()].map(([slug, label]) => ({ slug, label }));
  }, [products, locale]);

  function remove(productId: string) {
    toggle(productId);
    const remaining = products.filter((product) => product.id !== productId).map((p) => p.id);
    // docs/05 §9 — removing an item updates the URL, so the link still reproduces the table.
    router.replace(remaining.length > 0 ? `/compare?ids=${remaining.join(',')}` : '/compare');
  }

  const cells = (render: (product: CompareProduct) => React.ReactNode) =>
    products.map((product) => {
      const value = render(product);
      return { product, value };
    });

  /** True when the products disagree on this row — the highlight toggle keys on it. */
  const differs = (values: { value: React.ReactNode }[]) => {
    if (values.length < 2) return false;
    const asText = values.map((entry) => JSON.stringify(entry.value));
    return new Set(asText).size > 1;
  };

  function Row({
    label,
    render,
  }: {
    label: string;
    render: (product: CompareProduct) => React.ReactNode;
  }) {
    const values = cells(render);
    const isDifferent = highlight && differs(values);

    return (
      <tr className={cn('border-b border-line', isDifferent && 'bg-lime-500/10')}>
        <th
          scope="row"
          className="sticky left-0 z-10 bg-surface px-3 py-3 text-left align-top text-sm font-medium text-ink-900"
        >
          {label}
        </th>
        {values.map(({ product, value }) => (
          <td key={product.id} className="px-3 py-3 align-top text-sm text-ink-600">
            {value ?? <span className="text-ink-500">{t('notAvailable')}</span>}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-ink-900">
        <input
          type="checkbox"
          checked={highlight}
          onChange={(event) => setHighlight(event.target.checked)}
          className="size-4 rounded-[3px] border border-line-strong"
        />
        {t('highlightDifferences')}
      </label>

      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr className="border-b border-line">
              <td className="sticky left-0 z-10 w-32 bg-surface px-3 py-3" />
              {products.map((product) => {
                const name = pickLocale(product.name, locale);
                return (
                  <th
                    key={product.id}
                    scope="col"
                    className="min-w-52 px-3 py-3 align-top font-normal"
                  >
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => remove(product.id)}
                        aria-label={`${t('remove')}: ${name}`}
                        className="absolute top-0 right-0 rounded-sm p-1 text-ink-500 hover:text-ink-900"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>

                      <div className="size-20 overflow-hidden rounded-sm bg-cream">
                        <ProductImage
                          path={product.imagePath}
                          alt={name}
                          sizes="80px"
                          className="size-20 p-2"
                        />
                      </div>

                      {product.brandName && <p className="mt-2 eyebrow">{product.brandName}</p>}
                      <Link
                        href={`/product/${product.slug}`}
                        className="mt-0.5 block rounded-sm text-sm font-medium text-ink-900 hover:text-forest-800"
                      >
                        {name}
                      </Link>

                      <Link
                        href={`/product/${product.slug}`}
                        className={cn(buttonVariants({ size: 'sm' }), 'mt-2 w-full justify-center')}
                      >
                        {/*
                          A link to the product, not an add-to-cart button. docs/05 §9 sketches a
                          buy control in the header row, but a product with several variants
                          cannot be added from here without asking which one — and the whole
                          point of the table is that the visitor has not decided yet.
                        */}
                        {t('viewProduct')}
                      </Link>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            <Row
              label={t('rows.price')}
              render={(product) =>
                product.priceCents === null ? null : formatPrice(product.priceCents, locale)
              }
            />
            <Row
              label={t('rows.pricePerServing')}
              render={(product) =>
                product.priceCents !== null && product.servings
                  ? formatPrice(Math.round(product.priceCents / product.servings), locale)
                  : null
              }
            />
            <Row label={t('rows.form')} render={(product) => product.form} />
            <Row label={t('rows.servingSize')} render={(product) => product.servingSize} />
            <Row label={t('rows.stock')} render={(product) => (product.inStock ? '✓' : '—')} />
            <Row
              label={t('rows.rating')}
              render={(product) => (
                <RatingStars rating={product.ratingAvg} count={product.ratingCount} />
              )}
            />
            <Row
              label={t('rows.dietary')}
              render={(product) =>
                product.dietaryTags.length > 0
                  ? product.dietaryTags.map((tag) => tag.replace(/_/g, ' ')).join(', ')
                  : null
              }
            />
            <Row
              label={t('rows.certifications')}
              render={(product) =>
                product.certifications.length > 0 ? product.certifications.join(', ') : null
              }
            />

            {ingredientRows.map((ingredient) => (
              <Row
                key={ingredient.slug}
                label={ingredient.label}
                render={(product) => {
                  const match = product.ingredients.find((row) => row.slug === ingredient.slug);
                  if (!match) return null;
                  const amount =
                    match.amount === null
                      ? ''
                      : `${match.amount}${match.unit ? ` ${match.unit}` : ''}`;
                  const nrv = match.nrvPct === null ? '' : ` (${match.nrvPct}%)`;
                  return `${amount}${nrv}`.trim() || '✓';
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
