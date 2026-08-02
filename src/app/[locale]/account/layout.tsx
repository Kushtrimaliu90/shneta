import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { resolveLocale } from '@/i18n/locale';
import { localizePath } from '@/lib/i18n';
import { Navbar } from '@/components/storefront/navbar';
import { Footer } from '@/components/storefront/footer';
import { AccountNav } from '@/features/auth/components/account-nav';
import { SignOutButton } from '@/features/auth/components/sign-out-button';
import { getProfile } from '@/features/auth/queries';

/**
 * docs/05 §14 — account shell.
 *
 * Middleware already redirects unauthenticated requests here, but this checks again:
 * middleware is an optimisation, not the boundary. A missing profile is treated as
 * unauthenticated too — RLS would hide another user's row, so "no row" means "not us".
 */
export default async function AccountLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);

  const profile = await getProfile();
  /*
   * Localized, because a bare `redirect('/auth/sign-in')` always lands on the unprefixed —
   * Albanian — route. An English visitor being bounced into Albanian to sign in is the same
   * defect the sign-in action's `localizedRedirect` exists to avoid.
   */
  if (!profile) redirect(localizePath('/auth/sign-in?next=/account', locale));

  const t = await getTranslations();

  return (
    <>
      <a href="#main" className="skip-link">
        {t('common.skipToContent')}
      </a>
      <Navbar />

      <main id="main" className="container-page flex-1 py-8 lg:py-12">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow">{t('account.title')}</p>
            <h1 className="mt-1 font-display text-3xl font-semibold text-forest-900">
              {t('account.greeting', { name: profile.fullName || profile.email })}
            </h1>
          </div>
          <SignOutButton />
        </div>

        <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
          <AccountNav />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>

      <Footer />
    </>
  );
}
