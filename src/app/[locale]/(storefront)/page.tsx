import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { formatPrice } from '@/lib/money';
import { clientEnv } from '@/lib/env.client';
import { organizationSchema, webSiteSchema } from '@/lib/seo';
import { JsonLd } from '@/components/shared/json-ld';
import { ProductCard } from '@/components/storefront/product-card';
import { buttonVariants } from '@/components/ui/button';
import { getCategoryTree, listFeaturedProducts } from '@/features/catalog/queries';
import {
  getFreeShippingThresholdCents,
  getHeroSettings,
  getTrustItems,
  listHeroSlides,
} from '@/features/hero/queries';
import { HeroCarousel } from '@/features/hero/components/hero-carousel';
import { TrustStrip } from '@/features/hero/components/trust-strip';
import { IntentBand } from '@/features/hero/components/intent-band';
import { cn } from '@/lib/utils';

/**
 * docs/02 §5 — Home is static with a 300s ISR window plus tag-based purge.
 *
 * Must be a literal: Next statically analyses segment config and rejects an imported
 * identifier. Keep in sync with `ISR_REVALIDATE_SECONDS` in lib/constants.ts.
 */
export const revalidate = 300;

/**
 * Home (docs/05 §1).
 *
 * ── What changed, and the measurement that prompted it ──
 *
 * The hero was three message keys and a hardcoded photograph. It is now a carousel driven by
 * `hero_slides`, and the current copy survives unchanged as a pinned slide 1 (migration 74).
 *
 * The layout complaint was real and quantifiable. Measured on the live site before this change, the
 * `h1`'s bottom edge sat at **462 px of a 900 px viewport** — the headline began roughly 43% of the
 * way down, because a 667 × 898 portrait photograph in a two-column grid set the row height and
 * `items-center` parked the copy against the middle of it. `hero-slide.tsx` explains the three
 * changes that fix it; the short version is that the media now fills a box the layout chose rather
 * than choosing one for itself.
 *
 * ── The intent band replaces the goals grid ──
 *
 * This page previously ran a goals grid and a bestsellers row within one scroll, both of them
 * navigation. The band is that answer once, properly: four routes in, one of which is the goal index
 * the old grid duplicated.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);

  const [products, categories, slides, heroSettings, trustItems, thresholdCents] = await Promise.all(
    [
      listFeaturedProducts(8),
      getCategoryTree(),
      listHeroSlides(),
      getHeroSettings(),
      getTrustItems(),
      getFreeShippingThresholdCents(),
    ],
  );

  const t = await getTranslations();
  const origin = clientEnv.NEXT_PUBLIC_SITE_URL;
  const threshold = thresholdCents == null ? '' : formatPrice(thresholdCents, locale);

  return (
    <>
      {/* docs/08 §4 — Organization + WebSite/SearchAction on the home page only. */}
      <JsonLd schema={organizationSchema(origin)} />
      <JsonLd schema={webSiteSchema(origin)} />

      {/*
        No published slides is a real state — an operator can unpublish the last one — and it must not
        produce a blank page. The band and the catalogue below carry the homepage in that case, which
        is degraded but coherent.
      */}
      {slides.length > 0 && (
        <HeroCarousel
          slides={slides}
          settings={heroSettings}
          locale={locale}
        />
      )}

      <TrustStrip items={trustItems} locale={locale} freeShippingThreshold={threshold} />

      <IntentBand />

      {/* docs/05 §1.5 — bestsellers */}
      {products.length > 0 && (
        <section aria-labelledby="bestsellers-heading" className="bg-forest-50/50 section-y">
          <div className="container-page">
            <h2
              id="bestsellers-heading"
              className="font-display text-2xl font-semibold text-forest-900 lg:text-3xl"
            >
              {t('home.sections.bestsellers')}
            </h2>
            <ol className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
              {products.map((product) => (
                <li key={product.id} className="flex">
                  {/*
                    No longer `priority`. These sit below a fixed-height hero now, and four preloaded
                    images competing with the hero's own is how you make the LCP worse while trying to
                    make it better.
                  */}
                  <ProductCard product={product} className="w-full" />
                </li>
              ))}
            </ol>
            <Link href="/shop" className={cn(buttonVariants({ variant: 'secondary' }), 'mt-8')}>
              {t('home.sections.bestsellers')}
            </Link>
          </div>
        </section>
      )}

      {/* docs/05 §1.6 — category showcase */}
      {categories.length > 0 && (
        <section aria-labelledby="categories-heading" className="section-y">
          <div className="container-page">
            <h2
              id="categories-heading"
              className="font-display text-2xl font-semibold text-forest-900 lg:text-3xl"
            >
              {t('home.sections.categories')}
            </h2>
            <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {categories.slice(0, 6).map((category) => (
                <li key={category.slug}>
                  <Link
                    href={`/shop/${category.slug}`}
                    className="flex min-h-20 items-end rounded-lg bg-forest-50 p-4 transition-colors hover:bg-forest-100"
                  >
                    <span className="text-sm font-medium text-forest-900">
                      {pickLocale(category.name, locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
