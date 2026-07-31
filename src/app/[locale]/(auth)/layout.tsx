import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { BrandMark } from '@/components/storefront/brand-mark';

/**
 * docs/05 §15 — card layout, minimal, brand mark. No navbar or footer: an auth screen has
 * exactly one job, and the surrounding chrome is a set of ways to abandon it.
 */
export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale(resolveLocale((await params).locale));
  const t = await getTranslations('common');

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <a href="#main" className="skip-link">
        {t('skipToContent')}
      </a>

      <header className="container-page flex h-20 items-center">
        <Link href="/" className="rounded-sm" aria-label={t('brand')}>
          <BrandMark />
        </Link>
      </header>

      <main id="main" className="container-page flex flex-1 items-start justify-center pb-20">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
