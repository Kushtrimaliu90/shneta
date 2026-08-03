'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ArrowLeftRight, Sparkles, Trash2 } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { formatPrice } from '@/lib/money';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { EvidenceBadge } from '@/components/storefront/evidence-badge';
import { ProductImage } from '@/components/storefront/product-image';
import { DAY_PARTS, SLOT_DAY_PART, type DayPart, type ProtocolItem, type ProtocolResult, type TimingSlot } from '@/features/biohack/types';
import { ProtocolTrace } from '@/features/biohack/components/protocol-trace';
import { ProtocolActions } from '@/features/biohack/components/protocol-actions';

/**
 * docs/15 §1 step 3 — the protocol itself.
 *
 * A Client Component, because "Ndërro" and "Hiq" have to feel instant and the totals have to move
 * with them. Everything they need travels in the payload: the engine ships six ranked alternates
 * alongside the chosen items, so a swap is a re-render rather than a round trip.
 *
 * **Nothing here writes.** Swapping and removing change what this browser is looking at; the
 * stored row is the protocol as generated, and stays that way. Two people opening the same share
 * link therefore see the same protocol, which is what a shared link has to mean — and a customer
 * who removes something has not silently rewritten what compliance can point at.
 */

export interface ProductCard {
  id: string;
  slug: string;
  name: Record<string, string> | null;
  brandName: string;
  imagePath: string | null;
}

export function ProtocolView({
  result,
  products,
  goalNames,
  shareCode,
  shareUrl,
  readOnly = false,
  canSave = false,
  signInHref,
}: {
  result: ProtocolResult;
  products: Record<string, ProductCard>;
  goalNames: Record<string, string>;
  shareCode: string | null;
  shareUrl: string | null;
  /** The share page and the admin simulator render the same protocol without the controls. */
  readOnly?: boolean;
  canSave?: boolean;
  signInHref?: string;
}) {
  const t = useTranslations('biohack');
  const locale = useLocale() as Locale;

  const [removed, setRemoved] = useState<string[]>([]);
  /** Per original item key, how far through its option list the customer has clicked. */
  const [swapped, setSwapped] = useState<Record<string, number>>({});

  /**
   * The displayed list.
   *
   * Recomputed in one pass so a swap can never surface something already on screen: options are
   * filtered against the keys chosen by earlier items, in order. Doing this per item in isolation
   * is how two cards end up showing the same supplement.
   */
  const { shown, optionCounts } = useMemo(() => {
    const taken = new Set<string>();
    const list: { item: ProtocolItem; originKey: string; options: number }[] = [];
    const counts: Record<string, number> = {};

    for (const item of result.items) {
      if (removed.includes(item.key)) continue;

      const options = [
        item,
        ...result.alternates.filter(
          (alt) =>
            alt.key !== item.key &&
            !taken.has(alt.key) &&
            alt.goalSlugs.some((goal) => item.goalSlugs.includes(goal)),
        ),
      ];

      const index = (swapped[item.key] ?? 0) % options.length;
      const chosen = options[index] ?? item;

      taken.add(chosen.key);
      counts[item.key] = options.length;
      list.push({ item: chosen, originKey: item.key, options: options.length });
    }

    return { shown: list, optionCounts: counts };
  }, [result.items, result.alternates, removed, swapped]);

  const totalCents = shown.reduce((sum, entry) => sum + (entry.item.product?.priceCents ?? 0), 0);
  const variantIds = shown
    .map((entry) => entry.item.product?.variantId)
    .filter((id): id is string => Boolean(id));

  const cautions = shown.filter((entry) => entry.item.caution);
  const goalLabel = result.goalSlugs.map((slug) => goalNames[slug] ?? slug).join(' + ');

  const byDayPart = (part: DayPart) =>
    shown.filter((entry) => entry.item.timing.some((slot) => SLOT_DAY_PART[slot] === part));

  const dayPartLabel: Record<DayPart, string> = {
    mengjes: t('dayMorning'),
    dite: t('dayDay'),
    mbremje: t('dayEvening'),
  };

  return (
    <div className="flex flex-col gap-8 pb-28">
      <header>
        <p className="font-ui text-xs font-semibold tracking-wider text-forest-700 uppercase">
          {t('eyebrow')}
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-forest-900 sm:text-4xl">
          {goalLabel ? t('resultFor', { goals: goalLabel }) : t('resultTitle')}
        </h1>

        {/* Each chip in its own `<li>`: a `<ul>` may only directly contain list items, and axe
            is right to call the shorter version a structure violation. */}
        <ul className="mt-4 flex flex-wrap items-center gap-2">
          <li>
            <Chip>{t('duration', { days: result.durationDays })}</Chip>
          </li>
          {result.phased && (
            <li>
              <Chip tone="lime">{t('phased')}</Chip>
            </li>
          )}
          {result.configVersion > 0 && (
            <li>
              <Chip tone="quiet" data-numeric>
                v{result.configVersion}
              </Chip>
            </li>
          )}
        </ul>
      </header>

      {result.medicationCaution && (
        <Alert tone="error" title={t('cautionsTitle')}>
          {t('medicationBanner')}
        </Alert>
      )}

      {result.phased && <p className="text-sm text-ink-600">{t('phaseNote')}</p>}

      <div className="flex flex-col gap-8">
        {DAY_PARTS.map((part) => {
          const entries = byDayPart(part);
          if (entries.length === 0) return null;

          return (
            <section key={part} aria-labelledby={`part-${part}`}>
              <h2
                id={`part-${part}`}
                className="font-display text-lg font-semibold text-forest-900"
              >
                {dayPartLabel[part]}
              </h2>
              <ul className="mt-3 flex flex-col gap-3">
                {entries.map((entry) => (
                  <li key={`${part}-${entry.originKey}`}>
                    <ItemCard
                      item={entry.item}
                      product={
                        entry.item.product ? products[entry.item.product.productId] : undefined
                      }
                      goalNames={goalNames}
                      locale={locale}
                      readOnly={readOnly}
                      swapCount={optionCounts[entry.originKey] ?? 1}
                      onSwap={() =>
                        setSwapped((current) => ({
                          ...current,
                          [entry.originKey]: (current[entry.originKey] ?? 0) + 1,
                        }))
                      }
                      onRemove={() => setRemoved((current) => [...current, entry.originKey])}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {removed.length > 0 && !readOnly && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-cream px-4 py-3 text-sm">
          <span aria-live="polite" className="text-ink-600">
            {t('removed', {
              name: removed
                .map((key) => {
                  const item = result.items.find((entry) => entry.key === key);
                  return item ? pickLocale(item.name, locale) : key;
                })
                .join(', '),
            })}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setRemoved([])}>
            {t('undo')}
          </Button>
        </div>
      )}

      {cautions.length > 0 && (
        <section aria-labelledby="cautions">
          <h2 id="cautions" className="font-display text-lg font-semibold text-forest-900">
            {t('cautionsTitle')}
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {cautions.map((entry) => (
              <li key={entry.originKey} className="flex gap-2 text-sm text-ink-600">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                <span>
                  <strong className="font-medium text-ink-900">
                    {pickLocale(entry.item.name, locale)}
                  </strong>{' '}
                  {pickLocale(entry.item.caution, locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.metrics[locale].length > 0 && (
        <section
          aria-labelledby="metrics"
          className="rounded-lg border border-forest-500/30 bg-forest-50 p-5"
        >
          <h2 id="metrics" className="font-display text-lg font-semibold text-forest-900">
            {t('metricsTitle')}
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            {t('metricsHint', { days: result.durationDays })}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {result.metrics[locale].map((metric) => (
              <li key={metric} className="flex items-start gap-2 text-sm text-ink-900">
                <span
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 rounded-sm border border-forest-700/50 bg-surface"
                />
                {metric}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ProtocolTrace trace={result.trace} goalNames={goalNames} />

      <p className="border-t border-line pt-6 text-xs text-ink-500">{t('disclaimer')}</p>

      {readOnly ? (
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="text-sm text-ink-600">{t('shareIntro')}</p>
          <Link href="/biohack" className={cn(buttonVariants({ size: 'lg' }), 'mt-4')}>
            {t('shareCta')}
          </Link>
        </div>
      ) : (
        <ProtocolActions
          variantIds={variantIds}
          totalCents={totalCents}
          shareCode={shareCode}
          shareUrl={shareUrl}
          canSave={canSave}
          signInHref={signInHref}
        />
      )}
    </div>
  );
}

function ItemCard({
  item,
  product,
  goalNames,
  locale,
  readOnly,
  swapCount,
  onSwap,
  onRemove,
}: {
  item: ProtocolItem;
  product: ProductCard | undefined;
  goalNames: Record<string, string>;
  locale: Locale;
  readOnly: boolean;
  swapCount: number;
  onSwap: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('biohack');
  const isHabit = item.kind === 'habit';

  const slotLabel: Record<TimingSlot, string> = {
    mengjes: t('slotMengjes'),
    dite: t('slotDite'),
    mbremje: t('slotMbremje'),
    para_gjumit: t('slotParaGjumit'),
    me_ushqim: t('slotMeUshqim'),
    para_stervitjes: t('slotParaStervitjes'),
  };

  return (
    <article
      className={cn(
        'flex gap-4 rounded-lg border p-4',
        isHabit ? 'border-dashed border-lime-500/60 bg-lime-500/5' : 'border-line bg-surface',
      )}
    >
      {isHabit ? (
        <span className="flex size-16 shrink-0 items-center justify-center rounded-md bg-lime-500/15 text-forest-800">
          <Sparkles className="size-6" aria-hidden="true" />
        </span>
      ) : (
        <ProductImage
          path={product?.imagePath ?? null}
          alt={pickLocale(item.name, locale)}
          sizes="64px"
          className="size-16 shrink-0 overflow-hidden rounded-md object-cover"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-ui text-base font-semibold text-ink-900">
            {product ? pickLocale(product.name, locale) : pickLocale(item.name, locale)}
          </h3>
          {isHabit && <Chip tone="lime">{t('habit')}</Chip>}
          {item.phase === 2 && <Chip tone="quiet">{t('phaseTwoBadge')}</Chip>}
          {item.comingSoon && <Chip tone="quiet">{t('comingSoon')}</Chip>}
          <EvidenceBadge evidence={item.evidence} />
        </div>

        <p className="text-sm text-ink-600">
          {item.timing.map((slot) => slotLabel[slot]).join(' · ')}
        </p>

        {/*
         * The PSE line. `why` is the config's approved copy for the highest-weighted goal this
         * item serves; the goal names in front of it are the customer's own words back to them,
         * which is what turns a recommendation into an explanation (docs/15 §1).
         */}
        <p className="text-sm text-ink-900">
          <span className="font-ui text-xs font-semibold tracking-wide text-forest-700">
            {t('why')}
          </span>{' '}
          {/* `ink-600`, not `ink-500`: this line also sits on the lime habit tile, where the
              lighter tone drops below AA. One tone for both backgrounds beats two rules. */}
          <span className="text-ink-600">
            {item.goalSlugs.map((slug) => goalNames[slug] ?? slug).join(' + ')} —
          </span>{' '}
          {pickLocale(item.why, locale)}
        </p>

        {/*
          docs/15 §9 — why this item is here *for them*, beneath the PSE line that says why it is
          here at all.
          Rendered from the reasons a profile rule recorded, so a rule that changed nothing shows
          nothing: the difference between a protocol that is personalised and one that merely says
          it is.
        */}
        {item.profileReasons.length > 0 && (
          /*
           * A lime left border rather than a coloured label, because `lime-700` is not a token in
           * this theme — only 400, 500 and 950 are (CLAUDE.md §9), and reaching for it would have
           * silently rendered Tailwind's default lime instead of the brand's. The accent carries
           * the distinction from the PSE line above it and the type stays on `forest-700`.
           */
          <ul className="flex flex-col gap-1 border-l-2 border-lime-500 pl-3">
            {item.profileReasons.map((reason) => (
              <li key={reason.sq} className="text-sm text-ink-900">
                <span className="font-ui text-xs font-semibold tracking-wide text-forest-700">
                  {t('profileWhy')}
                </span>{' '}
                {pickLocale(reason, locale)}
              </li>
            ))}
          </ul>
        )}

        {item.servingsHint !== null && (
          <p className="text-sm font-medium text-forest-800" data-numeric>
            {t('servingsHint', { count: item.servingsHint })}
          </p>
        )}

        {item.comingSoon && <p className="text-xs text-ink-500">{t('comingSoonNote')}</p>}
      </div>

      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        {item.product && (
          <p className="font-ui text-base font-semibold text-forest-900" data-numeric>
            {formatPrice(item.product.priceCents, locale)}
          </p>
        )}

        {!readOnly && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onSwap}
              disabled={swapCount < 2}
              title={swapCount < 2 ? t('swapNone') : undefined}
              aria-label={`${t('swap')}: ${pickLocale(item.name, locale)}`}
            >
              <ArrowLeftRight className="size-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{t('swap')}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              aria-label={`${t('remove')}: ${pickLocale(item.name, locale)}`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span className="sr-only">{t('remove')}</span>
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

function Chip({
  children,
  tone = 'default',
  ...props
}: {
  children: React.ReactNode;
  tone?: 'default' | 'lime' | 'quiet';
} & React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'rounded-sm border px-1.5 py-0.5 font-ui text-[11px] font-semibold',
        tone === 'lime' && 'border-lime-500/50 bg-lime-500/10 text-forest-800',
        tone === 'quiet' && 'border-line-strong bg-cream text-ink-600',
        tone === 'default' && 'border-forest-500/40 bg-forest-50 text-forest-800',
      )}
      {...props}
    >
      {children}
    </span>
  );
}
