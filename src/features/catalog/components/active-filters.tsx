import { getLocale, getTranslations } from 'next-intl/server';
import { X } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { pickLocale, type LocalizedField } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { buildQuery } from '@/features/catalog/filters';
import type { CategoryNode, ProductFilters } from '@/features/catalog/types';

/**
 * docs/05 §2 — what is currently narrowing the list, as removable chips above the grid.
 *
 * ── Why this exists separately from the panel ──
 *
 * The commonest thing a person does after filtering is **undo one of them**, and on a phone that meant
 * opening the sheet, scrolling to the right group, finding the highlighted row and tapping it. Four
 * actions to reverse one. A chip row makes it a single tap on the thing you can already see.
 *
 * It also answers the question the sheet cannot while it is closed: *why am I only seeing six
 * products?* An empty result with no visible reason is the worst state a filtered listing has, and the
 * grid's empty state can only say "no products found" — the chips say what to remove.
 *
 * Server-rendered links, so this works with no JavaScript and is the fallback for everything the
 * mobile sheet does.
 */
export async function ActiveFilters({
  filters,
  basePath,
  categories,
  brands,
  goals,
}: {
  filters: ProductFilters;
  basePath: string;
  categories: CategoryNode[];
  brands: { slug: string; name: string }[];
  goals: { slug: string; name: LocalizedField }[];
}) {
  const t = await getTranslations();
  // Namespaced, like `FilterShell` — the dotted form does not typecheck for keys taking parameters.
  const ts = await getTranslations('shop');
  const locale = (await getLocale()) as Locale;

  /*
   * Slug → the label the visitor actually chose.
   *
   * A chip reading `bio-vitaminat-c` would be worse than no chip. Categories are a tree, so the lookup
   * flattens one level of children — the panel links to both depths.
   */
  const categoryName = new Map<string, string>();
  for (const node of categories) {
    categoryName.set(node.slug, pickLocale(node.name, locale));
    for (const child of node.children ?? []) {
      categoryName.set(child.slug, pickLocale(child.name, locale));
    }
  }
  const brandName = new Map(brands.map((b) => [b.slug, b.name]));
  const goalName = new Map(goals.map((g) => [g.slug, pickLocale(g.name, locale)]));

  const chips: { key: string; label: string; href: string }[] = [];
  const remove = (change: Parameters<typeof buildQuery>[1]) =>
    `${basePath}${buildQuery(filters, change)}`;

  for (const slug of filters.category ?? []) {
    chips.push({
      key: `category-${slug}`,
      label: categoryName.get(slug) ?? slug,
      href: remove({ toggle: { key: 'category', value: slug } }),
    });
  }
  for (const slug of filters.brand ?? []) {
    chips.push({
      key: `brand-${slug}`,
      label: brandName.get(slug) ?? slug,
      href: remove({ toggle: { key: 'brand', value: slug } }),
    });
  }
  for (const slug of filters.goal ?? []) {
    chips.push({
      key: `goal-${slug}`,
      label: goalName.get(slug) ?? slug,
      href: remove({ toggle: { key: 'goal', value: slug } }),
    });
  }
  for (const tag of filters.tag ?? []) {
    chips.push({
      key: `tag-${tag}`,
      label: t(`shop.tags.${tag}` as 'shop.tags.vegan'),
      href: remove({ toggle: { key: 'tag', value: tag } }),
    });
  }
  if (filters.inStock) {
    chips.push({
      key: 'inStock',
      label: t('shop.inStockOnly'),
      href: remove({ inStock: undefined }),
    });
  }
  if (filters.onSale) {
    chips.push({
      key: 'onSale',
      label: t('shop.onSaleOnly'),
      href: remove({ onSale: undefined }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <h2 className="sr-only">{ts('activeFilters')}</h2>
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          rel="nofollow"
          // The accessible name says what tapping does; the visible text is just the value.
          aria-label={ts('removeFilter', { name: chip.label })}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface py-1 pr-2 pl-3 text-sm text-ink-900"
        >
          {chip.label}
          <X className="size-3.5 text-ink-500" aria-hidden="true" />
        </Link>
      ))}

      {chips.length > 1 && (
        <Link
          href={basePath}
          rel="nofollow"
          className="min-h-9 rounded-sm px-1 py-1 text-sm text-forest-700 underline underline-offset-4"
        >
          {t('shop.clearFilters')}
        </Link>
      )}
    </div>
  );
}
