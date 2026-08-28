import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Clock, Mail, Phone } from 'lucide-react';
import { resolveLocale } from '@/i18n/locale';
import { getStoreSettings } from '@/features/content/queries';
import { ContactForm } from '@/features/content/components/contact-form';
import type { Locale } from '@/lib/constants';

type Props = { params: Promise<{ locale: string }> };

/** The form posts to a rate-limited action, so the page itself is rendered per request. */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'contact' });

  return {
    title: t('title'),
    description: t('intro'),
    alternates: { canonical: '/contact', languages: { sq: '/contact', en: '/en/contact' } },
  };
}

/** docs/05 §16 — contact. */
export default async function ContactPage({ params }: Props) {
  const locale = resolveLocale((await params).locale) as Locale;
  setRequestLocale(locale);

  const [t, store] = await Promise.all([getTranslations('contact'), getStoreSettings()]);

  return (
    <div className="container-page py-8 lg:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold text-forest-900 lg:text-display-md">
          {t('title')}
        </h1>
        <p className="mt-2 max-w-2xl text-ink-600">{t('intro')}</p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-14">
        <div className="max-w-xl">
          <ContactForm />
        </div>

        <aside>
          <h2 className="eyebrow">{t('otherWays')}</h2>
          <ul className="mt-3 flex flex-col gap-3 text-sm">
            {store.email && (
              <li className="flex items-center gap-2">
                <Mail className="size-4 shrink-0 text-forest-800" aria-hidden="true" />
                <a
                  href={`mailto:${store.email}`}
                  className="rounded-sm text-forest-800 underline underline-offset-4"
                >
                  {store.email}
                </a>
              </li>
            )}
            {store.phone && (
              <li className="flex items-center gap-2">
                <Phone className="size-4 shrink-0 text-forest-800" aria-hidden="true" />
                <a
                  href={`tel:${store.phone.replace(/\s/g, '')}`}
                  className="rounded-sm text-forest-800 underline underline-offset-4"
                  data-numeric
                >
                  {store.phone}
                </a>
              </li>
            )}
            <li className="flex items-center gap-2 text-ink-600">
              <Clock className="size-4 shrink-0 text-forest-800" aria-hidden="true" />
              {t('hours')}
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
