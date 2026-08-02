import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { CalendarClock, CheckCircle2, XCircle } from 'lucide-react';
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
    namespace: 'account.subscriptions',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * docs/07 §8.2 — the one-click landing page for a notice email's skip and pause links.
 *
 * **No sign-in.** That is the entire point: a customer reading "your delivery is being prepared"
 * on a phone has to be able to stop it in one tap, and an email that leads to a login form is an
 * email nobody acts on — the delivery arrives anyway and the shop takes a return.
 *
 * The token is the authorisation, and `subscription_apply_token` (migration 17) is what makes
 * that safe: single use, expiring, bound to one subscription and one verb. The action is not in
 * the URL, so a forwarded link cannot be edited from "skip" into "pause", let alone "cancel".
 *
 * State-changing on a GET, which is unusual enough to justify: an email client cannot POST. The
 * usual objection — a crawler or a prefetch triggering it — is covered by the token being
 * unguessable, single-use and known only to the recipient. `robots: noindex` keeps the page out
 * of an index either way.
 */
export default async function SubscriptionActionPage({ params, searchParams }: Props) {
  const [{ locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  const locale = resolveLocale(rawLocale) as Locale;
  setRequestLocale(locale);

  const t = await getTranslations('account.subscriptions');
  const raw = Array.isArray(query.token) ? query.token[0] : query.token;
  const token = raw?.trim() ?? '';

  let outcome: 'skipped' | 'paused' | 'failed' = 'failed';

  if (token) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc('subscription_apply_token', { p_token: token });

      if (error) {
        logger.warn('Subscription token apply failed', { cause: error.message });
      } else {
        const result = data as { ok?: boolean; action?: string } | null;
        if (result?.ok) outcome = result.action === 'pause' ? 'paused' : 'skipped';
      }
    } catch (error) {
      logger.error('Subscription token apply threw', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const succeeded = outcome !== 'failed';

  return (
    <div className="container-page flex flex-col items-center py-20 text-center">
      {succeeded ? (
        outcome === 'skipped' ? (
          <CalendarClock className="size-10 text-success" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
        )
      ) : (
        <XCircle className="size-10 text-ink-500" aria-hidden="true" />
      )}

      <h1 className="mt-4 font-display text-2xl font-semibold text-forest-900">
        {outcome === 'skipped'
          ? t('oneClick.skippedTitle')
          : outcome === 'paused'
            ? t('oneClick.pausedTitle')
            : t('oneClick.failedTitle')}
      </h1>
      <p className="mt-2 max-w-md text-ink-600">
        {outcome === 'skipped'
          ? t('oneClick.skippedBody')
          : outcome === 'paused'
            ? t('oneClick.pausedBody')
            : t('oneClick.failedBody')}
      </p>

      {/*
        The link goes to the account page, which does require signing in. That is the right split:
        stopping a delivery is urgent and must be frictionless; changing what is in it is not.
      */}
      <Link href="/account/subscriptions" className={buttonVariants({ className: 'mt-6' })}>
        {t('oneClick.manage')}
      </Link>
    </div>
  );
}
