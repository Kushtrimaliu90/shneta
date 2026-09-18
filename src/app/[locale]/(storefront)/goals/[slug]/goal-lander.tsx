import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { storageUrl } from '@/lib/storage';
import { ProductListingPage } from '@/features/catalog/components/plp';
import type { ProductFilters } from '@/features/catalog/types';
import { getGoalBySlug } from '@/features/catalog/queries';

/**
 * docs/05 §5 — goal detail: hero, then recommended products, which is the PLP scoped to that
 * goal. One body, two routes (owner cost report, 2026-09-18): the bare `/goals/[slug]` renders
 * it unfiltered and is PREBUILT — these are the highest-value SEO landing pages in the site,
 * which is exactly where a CDN-served response matters — while `/goals/[slug]/f` reads the
 * query and stays dynamic. `getGoalBySlug` is request-cached; metadata and body share a lookup.
 */
export async function GoalLander({
  slug,
  locale,
  filters,
}: {
  slug: string;
  locale: Locale;
  filters: ProductFilters;
}) {
  const goal = await getGoalBySlug(slug);
  if (!goal) notFound();

  const t = await getTranslations();
  const name = pickLocale(goal.name, locale);

  return (
    <>
      <nav aria-label={t('shop.breadcrumbs')} className="container-wide pt-6">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-500">
          <li>
            <Link
              href="/goals"
              className="rounded-sm underline underline-offset-4 hover:text-forest-700"
            >
              {t('goals.title')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink-900" aria-current="page">
            {name}
          </li>
        </ol>
      </nav>

      <ProductListingPage
        filters={{ ...filters, goal: [slug] }}
        basePath={`/goals/${slug}`}
        title={name}
        /*
          docs/05 §5 — "hero (name, tagline, image)", through the PLP's header slots. The tagline
          used to be an orphan section of its own, an eyebrow floating 32–48px above the h1 it
          belonged to; as the header's eyebrow it sits directly on the title. The image the goals
          index already renders joins it as compact media — these are the highest-value SEO
          landing pages and they carried none of their own identity.
        */
        eyebrow={pickLocale(goal.tagline, locale) || undefined}
        media={
          goal.imagePath ? (
            <span className="relative block size-14 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/60 lg:size-16">
              <Image
                src={storageUrl('brand-assets', goal.imagePath)}
                /* Decorative: the h1 beside it is the goal's name. */
                alt=""
                fill
                sizes="64px"
                className="object-cover"
              />
            </span>
          ) : undefined
        }
      />

      {/* docs/08 §7.3 — required on goal pages, which are educational surfaces. */}
      <div className="container-wide pb-12">
        <p className="max-w-3xl border-t border-line pt-6 text-xs leading-relaxed text-ink-500">
          {t('footer.disclaimer')}
        </p>
      </div>
    </>
  );
}
