import { getTranslations, setRequestLocale } from 'next-intl/server';
import { resolveLocale } from '@/i18n/locale';
import { Navbar } from '@/components/storefront/navbar';
import { Footer } from '@/components/storefront/footer';

/**
 * Storefront chrome (docs/05 §17). `main` carries the landmark and the skip-link target
 * (docs/04 §10); the skip link itself is the first focusable element on the page.
 */
export default async function StorefrontLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale(resolveLocale((await params).locale));
  const t = await getTranslations('common');

  return (
    <>
      <a href="#main" className="skip-link">
        {t('skipToContent')}
      </a>
      <Navbar />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  );
}
