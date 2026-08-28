import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Gift, Users } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import type { Locale } from '@/lib/constants';
import { formatPrice } from '@/lib/money';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/shared/empty-state';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { getLoyaltySettings } from '@/features/loyalty/queries';
import {
  getReferralOverview,
  isReferralProgrammeEnabled,
  referralQrDataUri,
  referralShareUrl,
  type ReferralListEntry,
} from '@/features/referrals/queries';
import { ReferralShareTools } from '@/features/referrals/components/share-tools';

type Props = { params: Promise<{ locale: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'account.referrals',
  });
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

/**
 * docs/17 §4 — the referrer's page.
 *
 * ── What is deliberately not on it ──
 *
 * No amount attributable to any one referral, no order count, no dates, no contact details. The list
 * shows a masked label, the month somebody joined, a status and the days remaining — and that is not a
 * choice this component makes. `my_referral_overview()` is the only read path a customer has, and it
 * does not return anything else; `referral_earnings` has no customer policy at all. So this page cannot
 * leak what it does not receive, which is the point of doing it in that order (docs/17 §0.2, §6).
 *
 * The one number that *is* per-person is the referrer's own total, which is theirs.
 */
export default async function AccountReferralsPage({ params }: Props) {
  const locale = resolveLocale((await params).locale) as Locale;
  setRequestLocale(locale);

  const [enabled, overview, loyalty, t] = await Promise.all([
    isReferralProgrammeEnabled(),
    getReferralOverview(),
    getLoyaltySettings(),
    getTranslations('account.referrals'),
  ]);

  // The account layout already redirects a signed-out visitor; this is the type narrowing.
  if (!overview) notFound();

  const shareUrl = referralShareUrl(overview.code);
  const { stats } = overview;

  /*
   * Points shown as points *and* as money, because a point is not a unit anybody has intuitions about.
   * `pointValueCents` comes from settings for the same reason the redeem button reads it: a hardcoded
   * conversion here would eventually contradict the button that spends them (docs/17 §0.1).
   */
  const asMoney = (points: number) => formatPrice(points * loyalty.pointValueCents, locale);

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-forest-900">{t('pageTitle')}</h2>
      <p className="mt-2 max-w-2xl text-sm text-ink-600">
        {t('pageIntro', { percent: 1, points: 100 })}
      </p>

      {!enabled && (
        <Alert tone="warning" className="mt-6">
          {t('paused')}
        </Alert>
      )}

      {/* ── Share ─────────────────────────────────────────────────────────────────────── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="rounded-lg border border-line bg-surface p-5">
          <ReferralShareTools code={overview.code} shareUrl={shareUrl} />
        </div>

        <div className="rounded-lg border border-line bg-surface p-5 text-center">
          <p className="eyebrow">{t('qrTitle')}</p>
          {/*
            A plain `<img>`, not `next/image`: the source is a `data:` URI produced on the server, so
            there is nothing for the image optimiser to fetch, resize or cache.

            `image-rendering: pixelated` is what makes it scannable — the default smoothing blurs a
            33-pixel image scaled to 160 and some scanners then fail on it.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={referralQrDataUri(overview.code)}
            alt={t('qrAlt', { code: overview.code })}
            width={160}
            height={160}
            className="mx-auto mt-3 size-40 [image-rendering:pixelated]"
          />
          <p className="mt-3 text-[13px] text-ink-500">{t('qrHint')}</p>
        </div>
      </div>

      {/* ── Stats ─────────────────────────────────────────────────────────────────────── */}
      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label={t('stats.approved')} value={stats.approved} />
        <Stat label={t('stats.pending')} value={stats.pending} />
        <Stat
          label={t('stats.expiring')}
          value={stats.expiring30d}
          tone={stats.expiring30d > 0 ? 'warning' : undefined}
        />
        <Stat label={t('stats.expired')} value={stats.expired} />
      </dl>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-forest-50 p-5">
          <p className="eyebrow">{t('stats.pointsAllTime')}</p>
          <p className="mt-1 font-display text-3xl font-semibold text-forest-900" data-numeric>
            {stats.pointsAllTime}
          </p>
          <p className="mt-1 text-sm text-ink-600">
            {t('worth', { value: asMoney(stats.pointsAllTime) })}
          </p>
          <Link
            href="/account/loyalty"
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-4')}
          >
            {t('goToWallet')}
          </Link>
        </div>

        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="eyebrow">{t('stats.pointsThisMonth')}</p>
          <p className="mt-1 font-display text-3xl font-semibold text-forest-900" data-numeric>
            {stats.pointsThisMonth}
          </p>
          {/*
            Says when the points arrive, because they do not arrive on delivery. Monthly posting is a
            privacy decision (docs/17 §0.2) and it looks like a delay unless it is explained.
          */}
          <p className="mt-1 text-sm text-ink-600">{t('postingNote')}</p>
        </div>
      </div>

      {/* ── The list ──────────────────────────────────────────────────────────────────── */}
      <h3 className="mt-10 font-display text-lg font-semibold text-forest-900">{t('listTitle')}</h3>

      {/*
        The empty state carries no action button. docs/04 §9 wants one to say what to do next, and the
        body does — the thing to do is send the link, which is the panel directly above this. A
        "referral terms" button here was a second link with the same accessible name as the one in the
        privacy note below, which is a needless ambiguity for anybody navigating by link.
      */}
      {overview.referrals.length === 0 ? (
        <EmptyState icon={Users} className="mt-4" title={t('empty.title')} body={t('empty.body')} />
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
          {overview.referrals.map((entry, index) => (
            <ReferralRow key={`${entry.maskedName}-${entry.joinedMonth}-${index}`} entry={entry} />
          ))}
        </ul>
      )}

      <p className="mt-6 text-[13px] text-ink-500">
        {t.rich('privacyNote', {
          terms: (chunks) => (
            <Link
              href="/legal/referral-terms"
              className="text-forest-700 underline underline-offset-4"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warning' }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cn(
          'mt-1 font-display text-2xl font-semibold',
          tone === 'warning' ? 'text-warning' : 'text-forest-900',
        )}
        data-numeric
      >
        {value}
      </dd>
    </div>
  );
}

async function ReferralRow({ entry }: { entry: ReferralListEntry }) {
  const t = await getTranslations('account.referrals');

  /*
   * The same palette rule as `OrderStatusPill`: a solid semantic fill with white text, never a tint of
   * the same colour, and always the word next to the colour (docs/04 §10). The four combinations are
   * asserted in `tests/unit/contrast.test.ts` alongside the order statuses.
   */
  const chip = {
    approved: 'bg-success text-white',
    pending: 'bg-warning text-white',
    revoked: 'bg-error text-white',
    expired: 'bg-ink-600 text-white',
  }[entry.status];

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <Gift className="size-4 shrink-0 text-forest-700" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">{entry.maskedName}</p>
          <p className="text-[13px] text-ink-500">{t('joinedIn', { month: entry.joinedMonth })}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/*
          Days remaining rather than an expiry date. A date is a fact about when somebody signed up —
          add twelve months and you have it — and the referrer does not need it to know the clock is
          running out.
        */}
        {entry.daysLeft !== null && (
          <span className="text-[13px] text-ink-500" data-numeric>
            {t('daysLeft', { count: entry.daysLeft })}
          </span>
        )}
        <span
          className={cn(
            'inline-flex items-center rounded-sm px-2 py-0.5 font-ui text-xs font-semibold whitespace-nowrap',
            chip,
          )}
        >
          {t(`status.${entry.status}`)}
        </span>
      </div>
    </li>
  );
}
