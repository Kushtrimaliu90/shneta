import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { formatPrice } from '@/lib/money';
import { clientEnv } from '@/lib/env.client';
import { organizationSchema, webSiteSchema } from '@/lib/seo';
import { JsonLd } from '@/components/shared/json-ld';
import { ProductCard } from '@/components/storefront/product-card';
import { getCategoryTiles, listFeaturedProducts } from '@/features/catalog/queries';
import { CategoryRow } from '@/features/catalog/components/category-row';
import { listArticles } from '@/features/content/queries';
import { ArticleCardTile } from '@/features/content/components/article-card';
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

  const [products, categoryTiles, slides, heroSettings, trustItems, thresholdCents, articleList] =
    await Promise.all([
      listFeaturedProducts(12),
      getCategoryTiles(8),
      listHeroSlides(),
      getHeroSettings(),
      getTrustItems(),
      getFreeShippingThresholdCents(),
      // docs/05 §1.8 — the three latest published articles. Cached and tagged like every
      // content read (`contentCache`), so the page stays static and a publish purges it.
      listArticles({}),
    ]);
  const articles = articleList.items.slice(0, 3);

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

      {/*
        docs/05 §1.5 — bestsellers.

        Fuller padding than the fold-budget bands above it, on purpose: the hero, trust strip and
        category row are squeezed so a 1366 × 768 laptop sees products without scrolling (see
        `category-row.tsx`), but below the fold that budget no longer applies and the tinted band
        can afford the spec's section rhythm (docs/04 §1). Still bespoke rather than `section-y` —
        uniform padding gives every boundary equal weight, and this page's rhythm is deliberate.

        Full-strength `forest-50`, not `forest-50/50`. The token is already the palette's section
        tint (docs/04 §3); halving its alpha over cream left a ~2% channel delta, and the band read
        as cream with a rendering artefact rather than as a section. If the tint is too strong the
        fix is a different token, not an alpha.
      */}
      {products.length > 0 && (
        <section aria-labelledby="bestsellers-heading" className="bg-forest-50 py-16 lg:py-24">
          <div className="container-wide">
            {/*
              Heading row: eyebrow + display-scale h2 on the left, the all-products link on the
              right baseline. The link used to sit alone under the grid, where a lone secondary
              button read as a stray CTA; on the heading row it is legible as "this section,
              continued" — the same arrangement the knowledge band uses below.
            */}
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div>
                <p className="eyebrow">{t('home.sections.bestsellersEyebrow')}</p>
                <h2
                  id="bestsellers-heading"
                  className="mt-2 font-display text-3xl font-medium text-forest-900 lg:text-display-md"
                >
                  {t('home.sections.bestsellers')}
                </h2>
              </div>
              <Link
                href="/shop"
                className="group inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-forest-700 transition-colors hover:text-forest-800"
              >
                {t('home.sections.allProducts')}
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </div>
            {/*
              The same ladder as the catalogue's full-width grid, and the reason the query above asks
              for twelve rather than eight: four frozen columns on a 1680px track is a 400px product
              card, which is not a premium signal, it is a stretched one.
            */}
            <ol className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6 xl:grid-cols-5 3xl:grid-cols-6">
              {products.map((product, index) => (
                /*
                  Twelve divides the 2-, 4- and 6-column rungs evenly but leaves 5+5+2 on the
                  xl five-column rung — the most common desktop range ending in a two-card
                  orphan row. Items eleven and twelve therefore sit out that one rung and
                  return at 3xl, where they complete the 2×6; the PDP's similar-products band
                  gates its fifth and sixth cards the same way.
                */
                <li key={product.id} className={cn('flex', index >= 10 && 'xl:hidden 3xl:flex')}>
                  {/*
                    No longer `priority`. These sit below a fixed-height hero now, and four preloaded
                    images competing with the hero's own is how you make the LCP worse while trying to
                    make it better.
                  */}
                  <ProductCard product={product} className="w-full" />
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/*
        docs/05 §1.8 — the Knowledge band: three latest published articles.

        Education had zero homepage presence until this landed, on a shop whose product pages link
        evidence per ingredient. A white (`bg-surface`) beat between the tinted grid and the cream
        intent band, which is what restores the section rhythm: dark hero, white strip, cream
        categories, tinted grid, white knowledge, cream band, dark footer.

        Renders nothing with no published articles — an empty CMS slot collapses rather than
        advertising its own absence (docs/05 §1 acceptance).
      */}
      {articles.length > 0 && (
        <section aria-labelledby="knowledge-heading" className="bg-surface py-16 lg:py-24">
          <div className="container-wide">
            {/* The same heading ladder and row as bestsellers, so the two sections read as siblings. */}
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div>
                <p className="eyebrow">{t('home.sections.knowledgeEyebrow')}</p>
                <h2
                  id="knowledge-heading"
                  className="mt-2 font-display text-3xl font-medium text-forest-900 lg:text-display-md"
                >
                  {t('home.sections.knowledge')}
                </h2>
              </div>
              <Link
                href="/knowledge"
                className="group inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-forest-700 transition-colors hover:text-forest-800"
              >
                {t('home.sections.allArticles')}
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </div>
            {/* The hub's tile in the hub's ladder, capped at three columns for three articles. */}
            <ol className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {articles.map((article) => (
                <li key={article.slug} className="flex">
                  <ArticleCardTile article={article} className="w-full" />
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/*
        The intent band, moved to the foot of the page from directly under the hero.

        Its four tiles point at `/goals`, `/shop?sort=rating`, `/offers` and `/shop/equipments`. Two of
        those are already in the header nav, the third is the bestsellers section further up the page,
        and the fourth is a category route — so at the top of the page, under a category strip that is
        *also* navigation, it had become the third consecutive answer to the same question. The note in
        `intent-band.tsx` is what warned against that arrangement; moving the categories up is what
        created it.

        At the foot of the page those same four tiles stop competing and start working: a reader who has
        scrolled the whole grid without buying is exactly who needs "where next". It also keeps the
        section rhythm — dark hero, white strip, cream categories, tinted grid, white knowledge band,
        cream band, dark footer — instead of the two adjacent cream blocks the move produced.

        Content note for whoever owns the tiles: "Më të shiturat" now sits under a section with that
        same heading. Renaming it, or pointing it somewhere the page does not already go, is a settings
        edit in /admin/hero rather than a code change.
      */}
      <IntentBand locale={locale} />
    </>
  );
}
