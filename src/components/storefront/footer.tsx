import { getLocale, getTranslations } from 'next-intl/server';
import { BadgeCheck, Truck } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { PRIMARY_NAV } from '@/components/storefront/nav-links';
import { NewsletterStatus } from '@/components/storefront/newsletter-status';

/**
 * docs/04 §6 — forest-950 ground, cream text; five columns, newsletter, payment badges,
 * legal row. The mandatory supplement disclaimer (docs/08 §7.3) sits above the legal row.
 *
 * The newsletter form posts to `/api/newsletter` so it degrades without JavaScript; the
 * double-opt-in action itself lands in M8 (docs/12).
 */
export async function Footer() {
  const t = await getTranslations();
  const locale = await getLocale();
  const year = new Date().getFullYear();

  const columns = [
    {
      heading: t('footer.shop'),
      links: PRIMARY_NAV.filter((link) => link.key !== 'knowledge').map((link) => ({
        href: link.href,
        label: t(`nav.${link.key}`),
      })),
    },
    {
      heading: t('footer.knowledgeColumn'),
      links: [
        { href: '/knowledge', label: t('nav.knowledge') },
        { href: '/ingredients', label: t('nav.ingredients') },
        { href: '/finder', label: t('home.hero.ctaSecondary') },
      ],
    },
    {
      heading: t('footer.company'),
      links: [
        { href: '/about', label: t('footer.about') },
        { href: '/contact', label: t('footer.contact') },
      ],
    },
    {
      heading: t('footer.help'),
      links: [
        { href: '/faq', label: t('footer.faq') },
        { href: '/order-lookup', label: t('footer.orderLookup') },
        { href: '/legal/shipping-returns', label: t('footer.shippingReturns') },
      ],
    },
  ];

  return (
    <footer className="mt-auto bg-forest-950 text-cream" data-print="hide">
      <div className="container-page py-14 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="max-w-xs">
            <p className="font-display text-xl font-semibold tracking-tight text-white">SHNETA</p>
            <p className="mt-3 text-sm text-white/70">{t('footer.tagline')}</p>

            <form action="/api/newsletter" method="post" className="mt-6">
              <p className="font-ui text-xs font-semibold tracking-[0.08em] text-white/60 uppercase">
                {t('footer.newsletter.title')}
              </p>
              <label htmlFor="footer-newsletter-email" className="mt-2 block text-sm text-white/70">
                {t('footer.newsletter.body')}
              </label>
              <div className="mt-3 flex gap-2">
                <input
                  id="footer-newsletter-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder={t('footer.newsletter.emailPlaceholder')}
                  aria-label={t('footer.newsletter.emailLabel')}
                  className="h-11 min-w-0 flex-1 rounded-md border border-white/25 bg-white/5 px-3 text-sm text-white placeholder:text-cream/40"
                />
                {/* docs/02 §9 — honeypot; real users never fill this. */}
                <input
                  type="text"
                  name="company"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="hidden"
                />
                <input type="hidden" name="locale" value={locale} />
                <button
                  type="submit"
                  className="h-11 shrink-0 rounded-md bg-lime-500 px-4 text-sm font-semibold text-lime-950 transition-colors hover:bg-lime-400"
                >
                  {t('footer.newsletter.submit')}
                </button>
              </div>
              <NewsletterStatus />
            </form>
          </div>

          {columns.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="font-ui text-xs font-semibold tracking-[0.08em] text-white/60 uppercase">
                {column.heading}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="rounded-sm text-sm text-white/80 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/15 pt-8">
          <span className="font-ui text-xs font-semibold tracking-[0.08em] text-white/50 uppercase">
            {t('footer.payments')}
          </span>
          <span className="inline-flex items-center gap-2 rounded-sm border border-white/20 px-3 py-1.5 text-xs text-white/80">
            <Truck className="size-4" aria-hidden="true" />
            {t('footer.codBadge')}
          </span>
          <span className="inline-flex items-center gap-2 rounded-sm border border-white/20 px-3 py-1.5 text-xs text-white/80">
            <BadgeCheck className="size-4" aria-hidden="true" />
            {t('home.trust.authentic.title')}
          </span>
        </div>

        {/* docs/08 §7.3 — mandatory, non-removable. */}
        <p className="mt-8 max-w-3xl text-xs leading-relaxed text-white/55">
          {t('footer.disclaimer')}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/55">
          <span>
            © {year} SHNETA. {t('footer.rights')}
          </span>
          <Link href="/legal/terms" className="rounded-sm hover:text-white">
            {t('footer.terms')}
          </Link>
          <Link href="/legal/privacy" className="rounded-sm hover:text-white">
            {t('footer.privacy')}
          </Link>
        </div>
      </div>
    </footer>
  );
}
