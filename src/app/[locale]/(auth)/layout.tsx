import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { BrandMark } from '@/components/storefront/brand-mark';

/**
 * docs/05 §15 — card layout, minimal, brand mark. No navbar or footer: an auth screen has
 * exactly one job, and the surrounding chrome is a set of ways to abandon it.
 *
 * The card gets a deliberate viewport-relative top offset rather than vertical centring:
 * `items-start` keeps its top edge at the same height across the different-height auth pages
 * (sign-in with OAuth is far taller than forgot-password), so moving between them never makes
 * the card jump. Without the offset, though, the card sat flush under the 80px header with
 * all the whitespace pooled below it — pinned to the ceiling rather than composed.
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

      <main
        id="main"
        className="container-page flex flex-1 items-start justify-center pt-[6vh] pb-20 lg:pt-[10vh]"
      >
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
