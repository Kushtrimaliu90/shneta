import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Scale } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import type { Locale } from '@/lib/constants';
import { EmptyState } from '@/components/shared/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { parseCompareIds } from '@/features/compare/constants';
import { listCompareProducts } from '@/features/compare/queries';
import { CompareTable } from '@/features/compare/components/compare-table';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * docs/05 §9 — dynamic, and not indexed.
 *
 * The URL is a scratchpad someone shared, not a page of the shop: every combination of four
 * products is a distinct URL, so letting a crawler in would generate an unbounded set of
 * near-duplicate pages out of the catalogue.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'compare',
  });
  return { title: t('title'), robots: { index: false, follow: true } };
}

export default async function ComparePage({ params, searchParams }: Props) {
  const [{ locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  const locale = resolveLocale(rawLocale) as Locale;
  setRequestLocale(locale);

  /*
   * The URL wins over the cookie, always.
   *
   * docs/05 §9 requires the link to reproduce the table. If the cookie were consulted here, a
   * recipient who happens to be comparing three other products would open the link and see
   * theirs — which makes the link useless for the one thing it exists to do. The cookie's job is
   * to survive a navigation *within* a session, and `CompareProvider` handles that on the client.
   */
  const ids = parseCompareIds(Array.isArray(query.ids) ? query.ids[0] : query.ids);
  const [products, t] = await Promise.all([listCompareProducts(ids), getTranslations('compare')]);

  return (
    <div className="container-page py-10">
      <h1 className="font-display text-3xl font-semibold text-carbon-900">{t('title')}</h1>

      {products.length === 0 ? (
        <EmptyState
          icon={Scale}
          title={t('empty')}
          body={t('emptyHint')}
          className="mt-8"
          action={
            <Link href="/shop" className={buttonVariants({ size: 'sm' })}>
              {t('browseShop')}
            </Link>
          }
        />
      ) : (
        <div className="mt-6">
          <CompareTable products={products} />
        </div>
      )}
    </div>
  );
}
