import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { resolveLocale } from '@/i18n/locale';
import { localizePath } from '@/lib/i18n';
import { Navbar } from '@/components/storefront/navbar';
import { Footer } from '@/components/storefront/footer';
import { SignOutButton } from '@/features/auth/components/sign-out-button';
import { getProfile } from '@/features/auth/queries';
import { isMerchant, isStaff } from '@/features/admin/roles';
import { getMyMerchant } from '@/features/merchants/queries';
import { MerchantNav } from '@/features/merchants/components/merchant-nav';
import { MerchantStatusBanner } from '@/features/merchants/components/merchant-status-banner';

/**
 * docs/16 §5 — the merchant portal shell.
 *
 * ── Why it is a sibling of `/account` and not part of the storefront group ──
 *
 * The portal is a working surface for a business, not a page a shopper browses. Putting it under the
 * storefront layout would wrap every screen in the wishlist and compare providers, the cookie banner
 * and the bottom stack — machinery for a shopper, mounted for somebody entering stock numbers. It
 * takes the navbar and footer because a merchant is still a visitor who needs to get back to the
 * shop, and nothing else.
 *
 * `/merchant/apply` stays in the storefront group and is unaffected: it is a public page with the
 * full storefront chrome, and it is the only `/merchant/*` route that does not require a session.
 *
 * ── Three gates, in this order ──
 *
 * 1. **Signed in.** Middleware redirects already, but middleware is an optimisation and not the
 *    boundary — a route reachable without it must still refuse.
 * 2. **Not staff.** A support agent who wandered in would otherwise get an empty portal and a
 *    confusing one; they are sent to `/admin`, which is where their work is.
 * 3. **A merchant membership.** `getMyMerchant` reads through RLS, so "no row" means no membership,
 *    a suspended merchant, or a rejected one — and the answer to all three is the same page.
 *
 * A signed-in user with no membership is sent to `/merchant/apply` rather than shown an error. That
 * is almost always what they are trying to do.
 *
 * The portal is **bilingual**, unlike `/admin`. Admin is English-only by decision (CLAUDE.md §3)
 * because it is staffed by people BioCode hires; a merchant is a Kosovo business that did not choose
 * BioCode's internal language, and asking one to manage its stock in English would be a real barrier
 * dressed up as a convention.
 */
export default async function MerchantPortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);

  const profile = await getProfile();
  if (!profile) redirect(localizePath('/auth/sign-in?next=/merchant', locale));

  // Staff have their own panel; a merchant portal with no merchant behind it would just confuse.
  if (isStaff(profile.role) && !isMerchant(profile.role)) redirect('/admin');

  const merchant = await getMyMerchant();
  if (!merchant) redirect(localizePath('/merchant/apply', locale));

  const t = await getTranslations('merchant.portal');

  return (
    <>
      <a href="#main" className="skip-link">
        {t('skipToContent')}
      </a>
      <Navbar />

      <main id="main" className="container-page flex-1 py-8 lg:py-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">{t('eyebrow')}</p>
            <h1 className="mt-1 font-display text-3xl font-semibold text-forest-900 lg:text-display-md">
              {merchant.displayName}
            </h1>
          </div>
          <SignOutButton />
        </div>

        {/*
          The status banner sits above the nav, not inside a page, because it is the answer to "why
          can I not do anything?" — and a merchant who is pending or suspended will look for that
          answer on whichever screen they happen to be on.
        */}
        <MerchantStatusBanner
          status={merchant.status}
          reviewerNote={merchant.reviewerNote}
          appliedAt={merchant.createdAt}
        />

        <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:gap-12">
          <MerchantNav approved={merchant.status === 'approved'} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>

      <Footer />
    </>
  );
}
