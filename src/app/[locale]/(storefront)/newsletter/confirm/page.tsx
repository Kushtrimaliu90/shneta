import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { buttonVariants } from '@/components/ui/button';
import { sendNewsletterWelcome } from '@/features/content/email';
import { DEFAULT_LOCALE, type Locale } from '@/lib/constants';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Spends a one-shot token, so it can never be cached or prerendered. */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'newsletter',
  });
  return { title: t('confirmTitle'), robots: { index: false, follow: false } };
}

/**
 * docs/08 §5 — the double opt-in landing page.
 *
 * The confirmation happens **here**, on a GET, which is unusual enough to justify: the link
 * comes from an email client, and an email client cannot POST. The token is one-shot and
 * unguessable, so the usual objection to state-changing GETs — that a crawler or a prefetch
 * will trigger it — costs nothing here: the only party who can follow this URL is whoever
 * received the email, and following it is what they were asked to do.
 *
 * `newsletter_confirm` returns the address and the unsubscribe token in the same call, so the
 * welcome email can go out without a second read. Reading the row first and confirming second
 * would race two clicks on the same link.
 */
export default async function NewsletterConfirmPage({ params, searchParams }: Props) {
  const [{ locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  const locale = resolveLocale(rawLocale) as Locale;
  setRequestLocale(locale);

  const t = await getTranslations('newsletter');
  const raw = Array.isArray(query.token) ? query.token[0] : query.token;
  const token = raw?.trim() ?? '';

  let confirmed = false;

  if (token) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc('newsletter_confirm', { p_token: token });

      if (error) {
        logger.warn('Newsletter confirm failed', { cause: error.message });
      } else {
        const result = data as {
          confirmed?: boolean;
          email?: string;
          locale?: string;
          unsubscribe_token?: string;
        } | null;

        confirmed = result?.confirmed === true;

        if (confirmed && result?.email && result.unsubscribe_token) {
          await sendNewsletterWelcome({
            to: result.email,
            // The locale they subscribed in, not the one this link happened to be opened in.
            locale: result.locale === 'en' ? 'en' : DEFAULT_LOCALE,
            unsubscribeToken: result.unsubscribe_token,
          });
        }
      }
    } catch (error) {
      logger.error('Newsletter confirm threw', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <div className="container-page flex flex-col items-center py-20 text-center">
      {confirmed ? (
        <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
      ) : (
        <XCircle className="size-10 text-ink-500" aria-hidden="true" />
      )}

      <h1 className="mt-4 font-display text-2xl font-semibold text-carbon-900">
        {confirmed ? t('confirmTitle') : t('confirmFailedTitle')}
      </h1>
      <p className="mt-2 max-w-md text-ink-600">
        {confirmed ? t('confirmBody') : t('confirmFailedBody')}
      </p>

      <Link href="/shop" className={buttonVariants({ className: 'mt-6' })}>
        {t('backHome')}
      </Link>
    </div>
  );
}
