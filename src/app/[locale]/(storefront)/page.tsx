import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BadgeCheck, RotateCcw, Truck, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { clientEnv } from '@/lib/env.client';
import { organizationSchema, webSiteSchema } from '@/lib/seo';
import { JsonLd } from '@/components/shared/json-ld';
import { ProductCard } from '@/components/storefront/product-card';
import { buttonVariants } from '@/components/ui/button';
import { getCategoryTree, listFeaturedProducts, listGoals } from '@/features/catalog/queries';
import { cn } from '@/lib/utils';

/**
 * docs/02 §5 — Home is static with a 300s ISR window plus tag-based purge.
 *
 * Must be a literal: Next statically analyses segment config and rejects an imported
 * identifier. Keep in sync with `ISR_REVALIDATE_SECONDS` in lib/constants.ts.
 */
export const revalidate = 300;

const TRUST_ITEMS: { key: 'shipping' | 'cod' | 'authentic' | 'returns'; icon: LucideIcon }[] = [
  { key: 'shipping', icon: Truck },
  { key: 'cod', icon: Wallet },
  { key: 'authentic', icon: BadgeCheck },
  { key: 'returns', icon: RotateCcw },
];

/**
 * Home (docs/05 §1). Sections 2–6 and 9 are live against the catalogue; the knowledge and
 * subscribe blocks arrive with M8 and M9.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);

  const [products, goals, categories] = await Promise.all([
    listFeaturedProducts(8),
    listGoals(),
    getCategoryTree(),
  ]);

  const t = await getTranslations();
  const origin = clientEnv.NEXT_PUBLIC_SITE_URL;

  return (
    <>
      {/* docs/08 §4 — Organization + WebSite/SearchAction on the home page only. */}
      <JsonLd schema={organizationSchema(origin)} />
      <JsonLd schema={webSiteSchema(origin)} />

      <section className="bg-cream section-y">
        <div className="container-page grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="eyebrow">{t('home.hero.eyebrow')}</p>
            {/*
              Rendered statically with a self-hosted swap font, so it paints on the first frame.

              It *was* the LCP element (docs/05 §1 acceptance), chosen as text precisely so it
              would be. The hero photograph beside it is larger and now takes that role; the note
              is kept because the heading still has to paint immediately whether or not it wins
              the measurement.
            */}
            <h1 className="mt-4 font-display text-[2.5rem] leading-[1.05] font-semibold tracking-tight text-balance text-forest-900 lg:text-[3.5rem]">
              {t('home.hero.title')}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ink-600">{t('home.hero.subtitle')}</p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/shop" className={cn(buttonVariants({ size: 'lg' }), 'sm:w-auto')}>
                {t('home.hero.ctaPrimary')}
              </Link>
              {/*
                The secondary CTA is the generator, not the goal index.
                Both answer "where do I start", and only one of them ends with the customer
                holding something. The goal index is still a click away in the nav and has its
                own section further down this page.
              */}
              <Link
                href="/biohack"
                className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'sm:w-auto')}
              >
                {t('biohack.title')}
              </Link>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            {/*
              The hero product shot, replacing the Vitality Ring placeholder that stood here
              while there was no photography.

              `width`/`height` are the file's real pixels and the box is `h-auto w-full`, so the
              aspect ratio comes from the image itself — nothing is cropped and the space is
              reserved before it loads, which is what keeps CLS at zero.

              **`priority` because this is now almost certainly the LCP element.** docs/05 §1
              recorded the H1 as the LCP, chosen deliberately when the right-hand side was an
              inline SVG; a 448 px-wide photograph above the fold takes that title. An
              above-the-fold image without `priority` is lazy-loaded and *delays* the LCP, so the
              honest fix is to preload it and keep the file small — the source is WebP at 122 kB
              (down from a 939 kB PNG), and Next serves AVIF on top of that.
            */}
            <Image
              src="/hero/lineup.webp"
              alt={t('home.hero.imageAlt')}
              width={667}
              height={898}
              sizes="(min-width: 1024px) 28rem, (min-width: 640px) 60vw, 90vw"
              priority
              className="h-auto w-full max-w-md rounded-[24px] border border-line object-cover"
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="trust-heading" className="border-y border-line bg-white">
        <h2 id="trust-heading" className="sr-only">
          {t('home.trust.authentic.title')}
        </h2>
        <div className="container-page grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:py-12">
          {TRUST_ITEMS.map(({ key, icon: Icon }) => (
            <div key={key} className="flex gap-3.5">
              <Icon className="mt-0.5 size-6 shrink-0 text-forest-500" aria-hidden="true" />
              <div>
                <p className="font-medium text-ink-900">{t(`home.trust.${key}.title`)}</p>
                <p className="mt-1 text-sm text-ink-500">{t(`home.trust.${key}.body`)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* docs/05 §1.4 — shop by goal */}
      {goals.length > 0 && (
        <section aria-labelledby="goals-heading" className="section-y">
          <div className="container-page">
            <h2
              id="goals-heading"
              className="font-display text-2xl font-semibold text-forest-900 lg:text-3xl"
            >
              {t('home.sections.goals')}
            </h2>
            <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {goals.slice(0, 8).map((goal) => (
                <li key={goal.slug}>
                  <Link
                    href={`/goals/${goal.slug}`}
                    className="flex min-h-24 flex-col justify-end rounded-lg border border-line bg-surface p-4 transition-colors hover:border-forest-500"
                  >
                    <span className="font-medium text-ink-900">
                      {pickLocale(goal.name, locale)}
                    </span>
                    {pickLocale(goal.tagline, locale) && (
                      <span className="mt-1 line-clamp-2 text-xs text-ink-500">
                        {pickLocale(goal.tagline, locale)}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/goals"
              className="mt-4 inline-block rounded-sm text-sm text-forest-700 underline underline-offset-4"
            >
              {t('home.sections.goals')}
            </Link>
          </div>
        </section>
      )}

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
              {products.map((product, index) => (
                <li key={product.id} className="flex">
                  <ProductCard product={product} priority={index < 4} className="w-full" />
                </li>
              ))}
            </ol>
            <Link href="/shop" className={cn(buttonVariants({ variant: 'secondary' }), 'mt-8')}>
              {t('home.hero.ctaPrimary')}
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
