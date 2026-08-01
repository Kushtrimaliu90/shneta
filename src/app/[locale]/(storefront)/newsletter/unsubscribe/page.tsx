import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { MailX } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { buttonVariants } from '@/components/ui/button';
import type { Locale } from '@/lib/constants';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'newsletter',
  });
  return { title: t('unsubscribedTitle'), robots: { index: false, follow: false } };
}

/**
 * docs/08 §5 — unsubscribe.
 *
 * One click, no confirmation step, no sign-in. Anything more is a dark pattern and, in the EU,
 * a compliance problem: the link in a marketing email has to work.
 *
 * The page reports success even for an unknown token. That is deliberate — a token that has
 * already been used, or one from a deleted row, leaves the reader in exactly the state they
 * wanted, and "that link is not valid" would send them looking for another way to get off a
 * list they are already off. It also stops the page being an oracle for guessed tokens.
 */
export default async function NewsletterUnsubscribePage({ params, searchParams }: Props) {
  const [{ locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  const locale = resolveLocale(rawLocale) as Locale;
  setRequestLocale(locale);

  const t = await getTranslations('newsletter');
  const raw = Array.isArray(query.token) ? query.token[0] : query.token;
  const token = raw?.trim() ?? '';

  if (token) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.rpc('newsletter_unsubscribe', { p_token: token });
      if (error) logger.warn('Newsletter unsubscribe failed', { cause: error.message });
    } catch (error) {
      logger.error('Newsletter unsubscribe threw', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <div className="container-page flex flex-col items-center py-20 text-center">
      <MailX className="size-10 text-ink-500" aria-hidden="true" />
      <h1 className="mt-4 font-display text-2xl font-semibold text-forest-900">
        {t('unsubscribedTitle')}
      </h1>
      <p className="mt-2 max-w-md text-ink-600">{t('unsubscribedBody')}</p>
      <Link href="/shop" className={buttonVariants({ className: 'mt-6' })}>
        {t('backHome')}
      </Link>
    </div>
  );
}
