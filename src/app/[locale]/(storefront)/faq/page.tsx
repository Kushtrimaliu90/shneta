import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { HelpCircle } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { faqSchema } from '@/lib/seo';
import { JsonLd } from '@/components/shared/json-ld';
import { EmptyState } from '@/components/shared/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { listFaqs } from '@/features/content/queries';
import type { Locale } from '@/lib/constants';

type Props = { params: Promise<{ locale: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'faq' });

  return {
    title: t('title'),
    description: t('intro'),
    alternates: { canonical: '/faq', languages: { sq: '/faq', en: '/en/faq' } },
  };
}

/** The categories the seed uses, in the order a customer meets them. */
const CATEGORY_ORDER = ['porosia', 'dergesa', 'pagesa', 'produktet', 'llogaria'] as const;
type KnownCategory = (typeof CATEGORY_ORDER)[number] | 'general';

function categoryKey(value: string): KnownCategory {
  return (CATEGORY_ORDER as readonly string[]).includes(value)
    ? (value as KnownCategory)
    : 'general';
}

/**
 * docs/05 §16 — the FAQ, grouped by category, with FAQPage JSON-LD.
 *
 * `<details>`/`<summary>` rather than a JavaScript accordion. It is keyboard operable, screen
 * readers announce the expanded state, it works before hydration and it needs no client
 * component — which for a page of static text is the whole job.
 */
export default async function FaqPage({ params }: Props) {
  const locale = resolveLocale((await params).locale) as Locale;
  setRequestLocale(locale);

  const [faqs, t] = await Promise.all([listFaqs(), getTranslations('faq')]);

  const grouped = new Map<KnownCategory, typeof faqs>();
  for (const faq of faqs) {
    const key = categoryKey(faq.category);
    grouped.set(key, [...(grouped.get(key) ?? []), faq]);
  }

  const sections = [...CATEGORY_ORDER, 'general' as const]
    .map((key) => ({ key, entries: grouped.get(key) ?? [] }))
    .filter((section) => section.entries.length > 0);

  return (
    <div className="container-page py-8 lg:py-12">
      {/*
        docs/08 §4 — FAQPage structured data, built from the same rows the page renders. A hand
        written schema block would be a second copy of the answers, and the two would diverge
        the first time somebody edited one.
      */}
      {faqs.length > 0 && (
        <JsonLd
          schema={faqSchema(
            faqs.map((faq) => ({
              question: pickLocale(faq.question, locale),
              answer: pickLocale(faq.answer, locale),
            })),
          )}
        />
      )}

      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold text-carbon-900 lg:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-2 max-w-2xl text-ink-600">{t('intro')}</p>
      </header>

      {faqs.length === 0 ? (
        <EmptyState icon={HelpCircle} title={t('empty')} body={t('intro')} />
      ) : (
        <div className="flex max-w-3xl flex-col gap-10">
          {sections.map((section) => (
            <section key={section.key}>
              <h2 className="font-display text-xl font-semibold text-carbon-900">
                {t(`categories.${section.key}`)}
              </h2>
              <ul className="mt-3 flex flex-col gap-2">
                {section.entries.map((faq) => (
                  <li key={faq.id}>
                    <details className="group rounded-lg border border-line bg-surface">
                      <summary className="flex cursor-pointer items-center justify-between gap-4 rounded-lg px-4 py-3 text-left font-medium text-ink-900 hover:bg-carbon-50">
                        {pickLocale(faq.question, locale)}
                        <span
                          aria-hidden="true"
                          className="shrink-0 text-ink-500 transition-transform group-open:rotate-45"
                        >
                          +
                        </span>
                      </summary>
                      <p className="border-t border-line px-4 py-3 text-sm leading-relaxed text-ink-600">
                        {pickLocale(faq.answer, locale)}
                      </p>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <div>
            <Link href="/contact" className={buttonVariants({ variant: 'secondary' })}>
              {t('contactCta')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
