import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ShieldCheck } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { buttonVariants } from '@/components/ui/button';
import type { Locale } from '@/lib/constants';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'biohack' });

  return { title: t('gatedTitle'), robots: { index: false, follow: false } };
}

/**
 * docs/15 §6 — the hard gate's landing page.
 *
 * Reached only by `buildProtocol` redirecting here when the life-stage answer is yes. It exists
 * as a route rather than a branch inside the result page for one reason: there is no result. No
 * row was written, no engine ran, and nothing about this screen depends on the other answers — so
 * giving it an address keeps that true and makes it directly testable.
 *
 * The tone is deliberately warm and the page offers somewhere to go. A refusal that ends in a
 * dead end reads as the shop protecting itself; docs/01 §2 asks for the opposite.
 */
export default async function GatedPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'biohack' });

  return (
    /* Prose tier (docs/04 §1) — a reading page, so it sets the site's reading measure and gutters. */
    <div className="container-text py-16 lg:py-24">
      <span className="flex size-12 items-center justify-center rounded-full bg-forest-50 text-forest-700">
        <ShieldCheck className="size-6" aria-hidden="true" />
      </span>

      <h1 className="mt-6 font-display text-2xl font-semibold text-forest-900 sm:text-3xl">
        {t('gatedTitle')}
      </h1>
      <p className="mt-4 text-ink-600">{t('gatedBody')}</p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/knowledge" className={buttonVariants({ size: 'lg' })}>
          {t('gatedKnowledge')}
        </Link>
        <Link href="/biohack" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
          {t('gatedBack')}
        </Link>
      </div>

      <p className="mt-12 border-t border-line pt-6 text-xs text-ink-500">{t('disclaimer')}</p>
    </div>
  );
}
