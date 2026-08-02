import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { routing } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { fontVariables } from '@/lib/fonts';
import { clientEnv } from '@/lib/env.client';
import { DEFAULT_LOCALE } from '@/lib/constants';
import '@/styles/globals.css';

type LayoutParams = { params: Promise<{ locale: string }> };

/** docs/02 §5 — both locales are prebuilt. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/** docs/08 §4 — `{Page} | BIOCODE`, absolute canonical, hreflang sq/en with x-default → sq. */
export async function generateMetadata({ params }: LayoutParams): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'common' });
  const origin = clientEnv.NEXT_PUBLIC_SITE_URL;

  return {
    metadataBase: new URL(origin),
    title: {
      default:
        locale === 'sq'
          ? 'BIOCODE — Suplemente dhe Wellness në Kosovë'
          : 'BIOCODE — Supplements and Wellness in Kosovo',
      template: '%s | BIOCODE',
    },
    description: t('tagline'),
    applicationName: 'BIOCODE',
    alternates: {
      canonical: locale === DEFAULT_LOCALE ? '/' : `/${locale}`,
      languages: { sq: '/', en: '/en', 'x-default': '/' },
    },
    openGraph: {
      type: 'website',
      siteName: 'BIOCODE',
      locale: locale === 'sq' ? 'sq_AL' : 'en_GB',
      url: origin,
    },
    robots: { index: true, follow: true },
    formatDetection: { telephone: false },
  };
}

export const viewport = {
  themeColor: '#faf9f5',
  colorScheme: 'light' as const,
};

/**
 * The root layout. It lives under `[locale]` because every storefront route is localized and
 * the middleware guarantees a locale segment (docs/08 §1); `/admin` is served from its own
 * un-localized tree (docs/02 §4).
 */
export default async function LocaleLayout({
  children,
  params,
}: LayoutParams & { children: React.ReactNode }) {
  const locale = resolveLocale((await params).locale);

  // Opts the subtree into static rendering (docs/02 §5).
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} className={fontVariables}>
      <body className="flex min-h-dvh flex-col antialiased">
        {/*
          No global MotionConfig: mounting it here would pull Framer Motion into the shared
          chunk of every route for the benefit of a handful of widgets. Framer is imported
          per-component instead — the cart drawer and mega menu are client-only and
          code-split (docs/09 §3) — while `prefers-reduced-motion` is honoured globally by
          the CSS rule in globals.css, which needs no JavaScript at all.
        */}
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
