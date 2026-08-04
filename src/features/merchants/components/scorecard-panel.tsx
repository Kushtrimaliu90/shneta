import { getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';
import type { Scorecard } from '@/features/merchants/proposal-queries';

/**
 * docs/16 §6 — the scorecard, as the merchant sees it.
 *
 * A server component, because it renders once and has no state.
 *
 * ── Why the merchant sees its own ──
 *
 * `merchants.rating_avg` is a **buy-box tie-break** (§1): it decides which of two equally-priced
 * merchants gets the sale. A measurement that decides revenue and cannot be seen by the party it
 * measures is not a measurement, it is a secret — so the same four numbers appear here and on the admin
 * side, from the same function.
 *
 * ── Null is not zero ──
 *
 * A merchant with no history has not failed at anything, and rendering 0% would tell it the opposite.
 * Every rate here is `null` until there is something to judge, and this component says so in words.
 */
export async function ScorecardPanel({
  scorecard,
  ratingAvg,
}: {
  scorecard: Scorecard;
  ratingAvg: number;
}) {
  const t = await getTranslations('merchant.scorecard');

  const percent = (rate: number | null): string =>
    rate === null ? t('noData') : `${Math.round(rate * 100)}%`;

  const hours = (value: number | null): string =>
    value === null ? t('noData') : t('hoursValue', { hours: value });

  const hasHistory = scorecard.shipped > 0;

  return (
    <section aria-labelledby="scorecard" className="flex flex-col gap-3">
      <h3 id="scorecard" className="font-display text-lg font-semibold text-forest-900">
        {t('title')}
      </h3>
      <p className="text-sm text-ink-600">{t('intro')}</p>

      <div className="rounded-lg border border-line bg-surface p-5">
        <p className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
          {t('rating')}
        </p>
        <p className="mt-1 font-display text-3xl font-semibold text-forest-900" data-numeric>
          {hasHistory ? ratingAvg.toFixed(2) : '—'}
          <span className="ml-1 font-ui text-base font-normal text-ink-500">/ 5</span>
        </p>
        <p className="mt-2 text-sm text-ink-600">
          {hasHistory ? t('ratingHint') : t('ratingNoHistory')}
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label={t('acceptance')}
          value={percent(scorecard.acceptanceRate)}
          hint={t('acceptanceHint')}
          tone={rateTone(scorecard.acceptanceRate, 0.9, 0.7, true)}
        />
        <Figure
          label={t('acceptSpeed')}
          value={hours(scorecard.avgAcceptHours)}
          hint={t('acceptSpeedHint')}
          tone={
            scorecard.avgAcceptHours === null
              ? 'neutral'
              : scorecard.avgAcceptHours <= 6
                ? 'good'
                : scorecard.avgAcceptHours <= 24
                  ? 'neutral'
                  : 'bad'
          }
        />
        <Figure
          label={t('dispatchSpeed')}
          value={hours(scorecard.avgDispatchHours)}
          hint={t('dispatchSpeedHint', { late: scorecard.lateDispatch })}
          tone={scorecard.lateDispatch === 0 ? 'good' : 'bad'}
        />
        <Figure
          label={t('cancellation')}
          value={percent(scorecard.cancellationRate)}
          hint={t('cancellationHint')}
          tone={rateTone(scorecard.cancellationRate, 0.02, 0.1, false)}
        />
      </dl>

      <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-line bg-cream p-4 text-sm sm:grid-cols-4">
        <Count label={t('assigned')} value={scorecard.assigned} />
        <Count label={t('accepted')} value={scorecard.accepted} />
        <Count label={t('declined')} value={scorecard.declined} />
        <Count label={t('delivered')} value={scorecard.delivered} />
      </dl>
    </section>
  );
}

type Tone = 'good' | 'neutral' | 'bad';

/**
 * A rate to a colour.
 *
 * `higherIsBetter` because acceptance and cancellation read in opposite directions, and two nearly
 * identical helpers is how one of them ends up green for the wrong reason.
 */
function rateTone(
  rate: number | null,
  goodAt: number,
  badAt: number,
  higherIsBetter: boolean,
): Tone {
  if (rate === null) return 'neutral';
  if (higherIsBetter) {
    if (rate >= goodAt) return 'good';
    return rate < badAt ? 'bad' : 'neutral';
  }
  if (rate <= goodAt) return 'good';
  return rate > badAt ? 'bad' : 'neutral';
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: Tone;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      {/*
        The hint lives **inside the `<dd>`**, not beside it.
        
        A `<dl>` may contain `<dt>`, `<dd>` and `<div>` wrappers, and a `<div>` inside one may contain
        only `<dt>` and `<dd>` — a sibling `<p>` makes the list invalid, which axe reports as
        `definition-list` at serious impact. It also reads better: the hint describes the value, so it
        belongs with it.
      */}
      <dd className="mt-1">
        <span
          className={cn(
            'font-display text-2xl font-semibold',
            tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-error' : 'text-ink-900',
          )}
          data-numeric
        >
          {value}
        </span>
        <span className="mt-1 block text-[13px] text-ink-500">{hint}</span>
      </dd>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className="font-ui font-semibold text-ink-900" data-numeric>
        {value}
      </dd>
    </div>
  );
}
