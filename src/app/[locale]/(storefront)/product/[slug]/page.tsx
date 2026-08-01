import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { AlertTriangle, BadgeCheck, RotateCcw, Truck } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { clientEnv } from '@/lib/env.client';
import { truncate } from '@/lib/utils';
import { breadcrumbSchema, productSchema } from '@/lib/seo';
import { JsonLd } from '@/components/shared/json-ld';
import { RatingStars } from '@/components/storefront/rating-stars';
import { ProductImage } from '@/components/storefront/product-image';
import { getProduct, listProducts } from '@/features/catalog/queries';
import { knownDietaryTags } from '@/features/catalog/filters';
import { BuyBox } from '@/features/cart/components/buy-box';
import { listProductReviews } from '@/features/reviews/queries';
import { ReviewsSection } from '@/features/reviews/components/reviews-section';
import { WishlistButton } from '@/features/wishlist/components/wishlist-button';
import { CompareButton } from '@/features/compare/components/compare-button';
import type { ProductVariantDetail } from '@/features/catalog/types';

type Props = { params: Promise<{ locale: string; slug: string }> };

/** docs/02 §5 — `generateStaticParams` prebuilds the top products; the rest render on demand. */
export async function generateStaticParams() {
  const result = await listProducts({ sort: 'rating' });
  return result.items.slice(0, 200).map((product) => ({ slug: product.slug }));
}

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocale(rawLocale);
  const product = await getProduct(slug);
  if (!product) return {};

  const name = pickLocale(product.name, locale);

  /*
   * docs/06 §3.5 — the editor's SEO override wins, and an empty one falls through to the
   * catalogue copy. Overriding is the exception: most products want their own name, and a field
   * that has to be filled in every time is a field nobody keeps current.
   */
  const title = pickLocale(product.seoTitle, locale) || name;
  const description =
    pickLocale(product.seoDescription, locale) ||
    pickLocale(product.subtitle, locale) ||
    truncate(pickLocale(product.description, locale), 155);

  return {
    title,
    description,
    alternates: {
      canonical: `/product/${slug}`,
      languages: { sq: `/product/${slug}`, en: `/en/product/${slug}` },
    },
    openGraph: { title, description, type: 'website' },
  };
}

/**
 * The variant the structured data describes: the default, or the first one.
 *
 * Deliberately *not* the same choice `BuyBox` makes for its opening selection — that one
 * skips an out-of-stock default so the customer does not land on a dead end, whereas the
 * canonical offer in JSON-LD should stay stable across restocks rather than move whenever
 * inventory changes.
 */
function primaryVariant(variants: ProductVariantDetail[]): ProductVariantDetail | undefined {
  return variants.find((variant) => variant.isDefault) ?? variants[0];
}

/**
 * docs/05 §3 — PDP.
 *
 * M3 renders everything except the purchase actions, which need the cart from M4: gallery,
 * price, variants, stock line, the ingredient label with %NRV, warnings, certifications and
 * the trust row. Reviews render read-only and currently show the "no reviews yet" state,
 * because review authorship needs seeded users.
 */
export default async function ProductPage({ params }: Props) {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);

  const product = await getProduct(slug);
  if (!product) notFound();

  const [t, reviews] = await Promise.all([getTranslations(), listProductReviews(product.id)]);
  const origin = clientEnv.NEXT_PUBLIC_SITE_URL;
  const name = pickLocale(product.name, locale);
  const variant = primaryVariant(product.variants);
  const warnings = pickLocale(product.warnings, locale);
  const description = pickLocale(product.description, locale);
  const howToUse = pickLocale(product.howToUse, locale);

  const trail = [
    { name: t('shop.title'), path: '/shop' },
    ...(product.primaryCategory
      ? [
          {
            name: pickLocale(product.primaryCategory.name, locale),
            path: `/shop/${product.primaryCategory.slug}`,
          },
        ]
      : []),
    { name, path: `/product/${slug}` },
  ];

  return (
    <>
      <JsonLd
        schema={productSchema(origin, {
          slug,
          name,
          description,
          brandName: product.brand.name,
          sku: variant?.sku ?? '',
          priceCents: variant?.priceCents ?? 0,
          /*
           * Availability is a property of the product, not of one variant: the whey's
           * default 900 g is in stock while its 2.27 kg is not, and marking the page
           * out-of-stock over that would suppress a buyable offer in Search.
           */
          inStock: product.variants.some((option) => option.stockStatus !== 'out_of_stock'),
          ratingAvg: product.ratingAvg,
          ratingCount: product.ratingCount,
        })}
      />
      <JsonLd schema={breadcrumbSchema(origin, trail)} />

      <nav aria-label={t('shop.breadcrumbs')} className="container-page pt-6">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-500">
          {trail.map((entry, index) => (
            <li key={entry.path} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden="true">/</span>}
              {index === trail.length - 1 ? (
                <span className="text-ink-900" aria-current="page">
                  {entry.name}
                </span>
              ) : (
                <Link
                  href={entry.path}
                  className="rounded-sm underline underline-offset-4 hover:text-forest-700"
                >
                  {entry.name}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <div className="container-page py-8 lg:py-12">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          {/* Gallery */}
          <div className="relative aspect-square overflow-hidden rounded-xl border border-line bg-cream">
            <ProductImage
              path={product.images[0]?.path ?? null}
              alt={pickLocale(product.images[0]?.alt, locale) || name}
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="absolute inset-0 size-full p-8"
            />
          </div>

          {/* Buy column */}
          <div>
            <Link
              href={`/brands/${product.brand.slug}`}
              className="rounded-sm eyebrow hover:text-forest-700"
            >
              {product.brand.name}
            </Link>

            <h1 className="mt-3 font-display text-3xl font-semibold text-forest-900 lg:text-4xl">
              {name}
            </h1>

            <div className="mt-3">
              <RatingStars rating={product.ratingAvg} count={product.ratingCount} size="md" />
            </div>

            {pickLocale(product.subtitle, locale) && (
              <p className="mt-4 text-ink-600">{pickLocale(product.subtitle, locale)}</p>
            )}

            {/*
              docs/05 §3 — price, variant choice, stock line and the primary action are one
              component because they are one decision; see the note in buy-box.tsx.
            */}
            <div className="mt-6">
              <BuyBox variants={product.variants} />
            </div>

            {/* docs/05 §3 — wishlist and compare sit under the buy action, not beside it. */}
            <div className="mt-3 flex flex-wrap items-center gap-1">
              <WishlistButton
                productId={product.id}
                productName={name}
                returnPath={`/product/${product.slug}`}
                variant="labelled"
              />
              <CompareButton productId={product.id} productName={name} variant="labelled" />
            </div>

            {/* Trust row (docs/04 §1.5 — microcopy near money) */}
            <ul className="mt-6 flex flex-col gap-2 text-sm text-ink-600">
              <li className="flex items-center gap-2">
                <Truck className="size-4 text-forest-500" aria-hidden="true" />
                {t('home.trust.cod.title')}
              </li>
              <li className="flex items-center gap-2">
                <RotateCcw className="size-4 text-forest-500" aria-hidden="true" />
                {t('home.trust.returns.body')}
              </li>
              <li className="flex items-center gap-2">
                <BadgeCheck className="size-4 text-forest-500" aria-hidden="true" />
                {t('home.trust.authentic.body')}
              </li>
            </ul>
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        <div className="mt-16 grid gap-12 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {description && (
              <section>
                <h2 className="font-display text-2xl font-semibold text-forest-900">
                  {t('product.description')}
                </h2>
                <p className="mt-4 leading-relaxed text-ink-600">{description}</p>
              </section>
            )}

            {/* docs/05 §3 — label-style table with amounts and %NRV. */}
            {product.ingredients.length > 0 && (
              <section className="mt-12">
                <h2 className="font-display text-2xl font-semibold text-forest-900">
                  {t('product.ingredients')}
                </h2>
                {product.servingSize && (
                  <p className="mt-2 text-sm text-ink-500">
                    {t('product.perServing', { serving: product.servingSize })}
                  </p>
                )}
                <div className="mt-4 overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t('product.ingredientsTableCaption')}</caption>
                    <thead className="bg-forest-50 text-ink-600">
                      <tr>
                        <th scope="col" className="px-4 py-2.5 text-left font-medium">
                          {t('product.ingredient')}
                        </th>
                        <th scope="col" className="px-4 py-2.5 text-right font-medium">
                          {t('product.amount')}
                        </th>
                        <th scope="col" className="px-4 py-2.5 text-right font-medium">
                          {t('product.nrv')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.ingredients.map((row) => (
                        <tr key={row.slug} className="border-t border-line">
                          <th scope="row" className="px-4 py-2.5 text-left font-normal">
                            <Link
                              href={`/ingredients/${row.slug}`}
                              className="rounded-sm text-forest-700 underline underline-offset-4"
                            >
                              {pickLocale(row.name, locale)}
                            </Link>
                          </th>
                          <td className="px-4 py-2.5 text-right" data-numeric>
                            {row.amount != null ? `${row.amount} ${row.unit ?? ''}`.trim() : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right" data-numeric>
                            {row.nrvPct != null ? `${row.nrvPct}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-ink-500">{t('product.nrvFootnote')}</p>
              </section>
            )}

            {howToUse && (
              <section className="mt-12">
                <h2 className="font-display text-2xl font-semibold text-forest-900">
                  {t('product.howToUse')}
                </h2>
                <p className="mt-4 leading-relaxed text-ink-600">{howToUse}</p>
              </section>
            )}

            {/* docs/05 §3 + docs/08 §7.4 — warnings render prominently and visually distinct. */}
            {warnings && (
              <section className="mt-12">
                <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
                  <AlertTriangle
                    className="mt-0.5 size-5 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                  <div>
                    <h2 className="font-medium text-ink-900">{t('product.warnings')}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-ink-600">{warnings}</p>
                  </div>
                </div>
              </section>
            )}

            {/*
              docs/05 §3 — page one is server-rendered so the review text is in the cached HTML,
              and everything viewer-specific arrives after mount. See `listProductReviews`.
            */}
            <ReviewsSection productId={product.id} productSlug={product.slug} initial={reviews} />
          </div>

          {/* Sidebar */}
          <aside className="flex flex-col gap-8">
            {product.certifications.length > 0 && (
              <section>
                <h2 className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
                  {t('product.certifications')}
                </h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {product.certifications.map((certification) => (
                    <li
                      key={certification.slug}
                      className="rounded-sm border border-line px-2.5 py-1 text-xs text-ink-600"
                    >
                      {pickLocale(certification.name, locale)}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {product.goals.length > 0 && (
              <section>
                <h2 className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
                  {t('product.goals')}
                </h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {product.goals.map((goal) => (
                    <li key={goal.slug}>
                      <Link
                        href={`/goals/${goal.slug}`}
                        className="inline-flex min-h-9 items-center rounded-sm bg-forest-50 px-2.5 text-sm text-forest-800 hover:bg-forest-100"
                      >
                        {pickLocale(goal.name, locale)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {knownDietaryTags(product.dietaryTags).length > 0 && (
              <section>
                <h2 className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
                  {t('shop.dietary')}
                </h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {knownDietaryTags(product.dietaryTags).map((tag) => (
                    <li
                      key={tag}
                      className="rounded-sm border border-line px-2.5 py-1 text-xs text-ink-600"
                    >
                      {t(`shop.tags.${tag}`)}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* docs/08 §7.3 — mandatory on the PDP ingredients surface. */}
            <p className="border-t border-line pt-6 text-xs leading-relaxed text-ink-500">
              {t('footer.disclaimer')}
            </p>
          </aside>
        </div>
      </div>
    </>
  );
}
