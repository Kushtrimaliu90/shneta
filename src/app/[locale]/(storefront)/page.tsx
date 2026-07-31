import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BadgeCheck, RotateCcw, Truck, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { VitalityRing } from '@/components/shared/vitality-ring';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * docs/02 §5 — Home is static with a 300s ISR window plus tag-based purge.
 *
 * Must be a literal: Next statically analyses segment config at build time and rejects an
 * imported identifier. Keep in sync with `ISR_REVALIDATE_SECONDS` in lib/constants.ts.
 */
export const revalidate = 300;

const TRUST_ITEMS: { key: 'shipping' | 'cod' | 'authentic' | 'returns'; icon: LucideIcon }[] = [
  { key: 'shipping', icon: Truck },
  { key: 'cod', icon: Wallet },
  { key: 'authentic', icon: BadgeCheck },
  { key: 'returns', icon: RotateCcw },
];

/**
 * Home (docs/05 §1). M0 ships sections 2 and 3 — hero and trust strip — because they are
 * the LCP surface the milestone is measured on. Sections 1 and 4–10 are data-driven and
 * land in M3 once the catalog exists.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(resolveLocale((await params).locale));
  const t = await getTranslations();

  return (
    <>
      <section className="bg-cream section-y">
        <div className="container-page grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="eyebrow">{t('home.hero.eyebrow')}</p>
            {/*
              The LCP element (docs/05 §1 acceptance). Text, not an image, and rendered
              statically with a self-hosted swap font so it paints on the first frame.
            */}
            <h1 className="mt-4 font-display text-[2.5rem] leading-[1.05] font-semibold tracking-tight text-balance text-forest-900 lg:text-[3.5rem]">
              {t('home.hero.title')}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ink-600">{t('home.hero.subtitle')}</p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/shop" className={cn(buttonVariants({ size: 'lg' }), 'sm:w-auto')}>
                {t('home.hero.ctaPrimary')}
              </Link>
              <Link
                href="/finder"
                className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'sm:w-auto')}
              >
                {t('home.hero.ctaSecondary')}
              </Link>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            <div className="relative flex aspect-square w-full max-w-md items-center justify-center rounded-[24px] border border-line bg-forest-50">
              <VitalityRing value={0.78} size={180} strokeWidth={10} />
              <span className="sr-only">{t('common.brand')}</span>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="trust-heading" className="border-y border-line bg-white">
        <h2 id="trust-heading" className="sr-only">
          {t('home.sections.subscribe')}
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

      <section className="section-y">
        <div className="container-page">
          <div className="mx-auto max-w-2xl rounded-[16px] border border-dashed border-line bg-surface p-10 text-center">
            <h2 className="font-display text-2xl font-semibold text-forest-900">
              {t('home.placeholder.title')}
            </h2>
            <p className="mt-3 text-ink-600">{t('home.placeholder.body')}</p>
          </div>
        </div>
      </section>
    </>
  );
}
