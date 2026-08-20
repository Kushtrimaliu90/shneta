import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { formatPrice } from '@/lib/money';
import { clientEnv } from '@/lib/env.client';
import { organizationSchema, webSiteSchema } from '@/lib/seo';
import { JsonLd } from '@/components/shared/json-ld';
import { ProductCard } from '@/components/storefront/product-card';
import { buttonVariants } from '@/components/ui/button';
import { getCategoryTiles, listFeaturedProducts } from '@/features/catalog/queries';
import { CategoryRow } from '@/features/catalog/components/category-row';
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
// Keep in sync with `ISR_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 3600;

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

  const [products, categoryTiles, slides, heroSettings, trustItems, thresholdCents] =
    await Promise.all([
      listFeaturedProducts(12),
      getCategoryTiles(8),
      listHeroSlides(),
      getHeroSettings(),
      getTrustItems(),
      getFreeShippingThresholdCents(),
    ]);

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
        <HeroCarousel slides={slides} settings={heroSettings} locale={locale} />
      )}

      <TrustStrip items={trustItems} locale={locale} freeShippingThreshold={threshold} />

      {/*
        docs/05 §1.6 — the category showcase, rebuilt on real product photography (docs/13 §AJ).

        **Directly under the trust strip, not at the foot of the page.** Categories are what most
        people arrive looking for, and they were the last thing on the page: measured on the live
        site at 1920 x 937 the shelf's heading sat at roughly 2560 px, so finding it took about two
        and a half screens of scrolling past a hero, four intent tiles and twelve product cards.
        A shopper who knows they want vitamins should not have to read the whole homepage first.

        It is the only navigation block at the top of the page now. The intent band used to sit here
        and has moved below the grid — categories are the concrete answer ("vitamins, minerals, sports
        nutrition"), and stacking the oblique one ("by goal, bestsellers, offers") underneath it made
        the top of the page answer the same question three times over.
      */}
      <CategoryRow tiles={categoryTiles} locale={locale} />

      {/* docs/05 §1.5 — bestsellers */}
      {products.length > 0 && (
        <section aria-labelledby="bestsellers-heading" className="bg-forest-50/50 py-12 lg:py-16">
          <div className="container-wide">
            <h2
              id="bestsellers-heading"
              className="font-display text-2xl font-semibold text-forest-900 lg:text-3xl"
            >
              {t('home.sections.bestsellers')}
            </h2>
            {/*
              The same ladder as the catalogue's full-width grid, and the reason the query above asks
              for twelve rather than eight: four frozen columns on a 1680px track is a 400px product
              card, which is not a premium signal, it is a stretched one.
            */}
            <ol className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6 xl:grid-cols-5 3xl:grid-cols-6">
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
            {/*
              Not the section's own heading, which is what this said: 'Më të shiturat' as a title and
              'Më të shiturat' again as the button under it reads as a bug rather than as a link.
            */}
            <Link href="/shop" className={cn(buttonVariants({ variant: 'secondary' }), 'mt-8')}>
              {t('home.sections.allProducts')}
            </Link>
          </div>
        </section>
      )}

      {/*
        The intent band, moved to the foot of the page from directly under the hero.

        Its four tiles point at `/goals`, `/shop?sort=rating`, `/offers` and `/shop/equipments`. Two of
        those are already in the header nav, the third is the section immediately above this one, and
        the fourth is a category route — so at the top of the page, under a category strip that is
        *also* navigation, it had become the third consecutive answer to the same question. The note in
        `intent-band.tsx` is what warned against that arrangement; moving the categories up is what
        created it.

        At the foot of the page those same four tiles stop competing and start working: a reader who has
        scrolled the whole grid without buying is exactly who needs "where next". It also restores the
        section rhythm — dark hero, white strip, cream categories, tinted grid, cream band, dark footer
        — instead of the two adjacent cream blocks the move produced.

        Content note for whoever owns the tiles: "Më të shiturat" now sits under a section with that
        same heading. Renaming it, or pointing it somewhere the page does not already go, is a settings
        edit in /admin/hero rather than a code change.
      */}
      <IntentBand locale={locale} />
    </>
  );
}
