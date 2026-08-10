'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import { formatPrice, fromCents } from '@/lib/money';
import type { Locale } from '@/lib/constants';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  createOffer,
  deleteOffer,
  setOfferStatus,
  updateOffer,
  type OfferState,
} from '@/features/merchants/offer-actions';
import type { CatalogVariantOption, OfferRow } from '@/features/merchants/queries';
import { offerErrorLeaf } from '@/features/merchants/error-keys';

/**
 * Brand → its variants, preserving the order the query already sorted them into.
 *
 * A Map keeps insertion order, so the groups come out in the brand-then-product sequence the view's
 * `sort_key` produced. No second sort, and therefore no chance of the group order disagreeing with
 * the order inside each group.
 */
function groupByBrand(entries: CatalogVariantOption[]): [string, CatalogVariantOption[]][] {
  const groups = new Map<string, CatalogVariantOption[]>();
  for (const entry of entries) {
    const list = groups.get(entry.brandName);
    if (list) list.push(entry);
    else groups.set(entry.brandName, [entry]);
  }
  return [...groups.entries()];
}

/**
 * docs/16 §5 — one offer, created or edited.
 *
 * ── What the merchant is actually agreeing to, made visible ──
 *
 * The form shows **two numbers** and the relationship between them, because the relationship is the deal
 * and hiding it would be the marketplace's central unfairness:
 *
 *   · the merchant's **asking price**, which is what it wants for the unit and what the buy box sorts on;
 *   · what **settlement pays**, which is the retail price less this merchant's commission.
 *
 * A merchant asking more than settlement pays is telling BioCode the margin does not work, and it is
 * better that they see that on this screen than discover it on a statement. The warning below says so
 * without blocking the submission — it may be exactly what they mean, and a rate can be renegotiated.
 *
 * ── It used to show three ──
 *
 * The third was BioCode's retail price, and it is gone by owner decision (2026-08-05): merchants should
 * not be pricing against BioCode's number on BioCode's own screen. Nothing they need in order to decide
 * went with it — the asking-price warning compares against settlement, which is the figure that lands in
 * their payout.
 *
 * The retail price is still fetched, because the settlement figure is derived from it, but it stops on
 * the server: `CatalogVariantOption.retailPriceCentsInternal` is named to make widening a props object
 * an act somebody has to notice.
 */
export function OfferForm({
  mode,
  locale,
  variants,
  offeredVariantIds,
  offer,
  settlementPerUnitCents,
  maxHandlingDays,
}: {
  mode: 'create' | 'edit';
  locale: Locale;
  /** The canonical catalogue, for the create form's picker. Empty when editing. */
  variants: CatalogVariantOption[];
  /** Variants this merchant already offers, so the picker can say so instead of erroring later. */
  offeredVariantIds?: Set<string>;
  offer?: OfferRow;
  /**
   * What settlement would pay per unit for the *selected* variant. On the create form it is a map
   * keyed by variant id, because the answer changes with the selection.
   */
  settlementPerUnitCents: Record<string, number>;
  maxHandlingDays: number;
}) {
  const t = useTranslations('merchant.offers.form');
  const te = useTranslations('merchant.offers.errors');
  /*
   * next-intl's router, not `next/navigation`'s.
   *
   * The plain one pushes the path verbatim, so a merchant working in English at
   * `/en/merchant/offers/new` was sent to `/merchant/offers` — the unprefixed, Albanian route — the
   * moment their offer saved. The E2E journey caught it: the list rendered in Albanian and the
   * assertion for "In review" found "Në shqyrtim".
   *
   * It is the same defect the account layout's `localizedRedirect` note describes, one layer up, and
   * it is invisible to anyone developing in the default locale.
   */
  const router = useRouter();

  /*
   * The first variant the merchant does not already offer, not simply the first.
   *
   * Now that taken variants render disabled, preselecting index 0 could arm the form with a choice the
   * merchant cannot submit — and the refusal would arrive from the unique constraint after they had
   * filled in price, stock and SKU.
   */
  const [variantId, setVariantId] = useState(
    offer?.variantId ??
      variants.find((entry) => !offeredVariantIds?.has(entry.variantId))?.variantId ??
      '',
  );
  const [asking, setAsking] = useState(offer ? fromCents(offer.askingPriceCents) : '');

  const [state, action] = useActionState<OfferState, FormData>(async (previous, formData) => {
    const result = mode === 'create'
      ? await createOffer(previous, formData)
      : await updateOffer(previous, formData);
    if (result?.ok) router.push('/merchant/offers');
    return result;
  }, null);

  /*
   * What the merchant is paid per unit, and no longer what BioCode charges for it.
   *
   * The panel below showed the shelf price beside this figure. It is gone by owner decision
   * (2026-08-05): a merchant should not be pricing against BioCode's number on BioCode's own screen. The
   * settlement figure is theirs — it is what lands in their payout — and it is what the asking-price
   * warning compares against, so nothing they need to decide has been taken away.
   *
   * Honest about the limit: commission is on their own merchant record, so anybody determined can work
   * the shelf price back out of these two numbers. Removing it stops the form from doing that work for
   * them; it does not make the price a secret, and the storefront never could.
   */
  const dueCents = settlementPerUnitCents[variantId] ?? offer?.merchantDueCents ?? 0;

  const askingCents = Math.round(Number(asking.replace(',', '.')) * 100);
  const askingAboveDue = Number.isFinite(askingCents) && askingCents > dueCents && dueCents > 0;

  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-5">
        {mode === 'edit' && offer && <input type="hidden" name="offerId" value={offer.id} />}

        {mode === 'create' ? (
          <Field id="variantId" label={t('variant')} hint={t('variantHint')} required>
            {(field) => (
              <select
                {...field}
                name="variantId"
                value={variantId}
                onChange={(event) => setVariantId(event.target.value)}
                className="h-11 w-full rounded-sm border border-line-strong bg-surface px-3 text-base text-ink-900"
              >
                <option value="">{t('variantPlaceholder')}</option>
                {/*
                  Grouped by brand, because the list is now the whole catalogue rather than the first
                  twenty SKUs. A merchant looks for "the Solgar one", and `<optgroup>` is the native
                  control that answers that — it also gives the browser's type-ahead something to land
                  on when the select is focused.
                */}
                {groupByBrand(variants).map(([brand, entries]) => (
                  <optgroup key={brand} label={brand}>
                    {entries.map((entry) => {
                      const taken = offeredVariantIds?.has(entry.variantId) ?? false;
                      return (
                        <option
                          key={entry.variantId}
                          value={entry.variantId}
                          /*
                            Disabled rather than omitted. "You already sell this" is a more useful
                            answer than the product being missing, and it is the same answer the
                            unique constraint gives — except here it arrives before the merchant has
                            filled in price, stock and SKU.
                          */
                          disabled={taken}
                        >
                          {pickLocale(entry.productName, locale)}
                          {pickLocale(entry.variantName, locale)
                            ? ` — ${pickLocale(entry.variantName, locale)}`
                            : ''}{' '}
                          ({entry.sku}){taken ? ` — ${t('alreadyOffered')}` : ''}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
            )}
          </Field>
        ) : (
          offer && (
            <div className="rounded-lg border border-line bg-cream p-4">
              <p className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                {t('variant')}
              </p>
              <p className="mt-0.5 font-medium text-ink-900">
                {pickLocale(offer.productName, locale)}
              </p>
              <p className="text-[13px] text-ink-600">
                {pickLocale(offer.variantName, locale) || offer.sku} · {offer.sku}
              </p>
              {/* The variant is fixed after creation: one offer per merchant per variant, and
                  moving an offer to a different product would silently change what it sells. */}
              <p className="mt-2 text-[13px] text-ink-500">{t('variantLocked')}</p>
            </div>
          )
        )}

        {dueCents > 0 && (
          <dl className="grid gap-3 rounded-lg border border-line bg-surface p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                {t('due')}
              </dt>
              <dd className="mt-0.5">
                <span className="font-medium text-forest-900" data-numeric>
                  {formatPrice(dueCents, locale)}
                </span>
                <span className="block text-[13px] text-ink-500">
                  {t('dueHint', { pct: offer?.commissionPct ?? 0 })}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                {t('askingShort')}
              </dt>
              <dd className="mt-0.5">
                <span className="font-medium text-ink-900" data-numeric>
                  {Number.isFinite(askingCents) && askingCents > 0
                    ? formatPrice(askingCents, locale)
                    : '—'}
                </span>
                <span className="block text-[13px] text-ink-500">{t('askingShortHint')}</span>
              </dd>
            </div>
          </dl>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="priceEuro" label={t('asking')} hint={t('askingHint')} required>
            {(field) => (
              <Input
                {...field}
                name="priceEuro"
                type="text"
                inputMode="decimal"
                value={asking}
                onChange={(event) => setAsking(event.target.value)}
                autoComplete="off"
              />
            )}
          </Field>

          <Field id="merchantSku" label={t('merchantSku')} hint={t('merchantSkuHint')}>
            {(field) => (
              <Input
                {...field}
                name="merchantSku"
                defaultValue={offer?.merchantSku ?? ''}
                autoComplete="off"
              />
            )}
          </Field>

          <Field id="stockOnHand" label={t('stock')} hint={t('stockHint')} required>
            {(field) => (
              <Input
                {...field}
                name="stockOnHand"
                type="number"
                min={0}
                step={1}
                defaultValue={offer?.stockOnHand ?? 0}
              />
            )}
          </Field>

          <Field
            id="lowStockThreshold"
            label={t('threshold')}
            hint={t('thresholdHint')}
            required
          >
            {(field) => (
              <Input
                {...field}
                name="lowStockThreshold"
                type="number"
                min={0}
                step={1}
                defaultValue={offer?.lowStockThreshold ?? 3}
              />
            )}
          </Field>

          <Field
            id="handlingDays"
            label={t('handling')}
            hint={t('handlingHint', { max: maxHandlingDays })}
            required
          >
            {(field) => (
              <Input
                {...field}
                name="handlingDays"
                type="number"
                min={0}
                max={maxHandlingDays}
                step={1}
                defaultValue={offer?.handlingDays ?? 1}
              />
            )}
          </Field>
        </div>

        {/*
          Said before saving, not discovered afterwards.

          A price change on an approved offer returns it to review (migration 80), and the buy box only
          considers approved offers — so correcting a typo takes the product off the shelf until a
          reviewer looks. That is the behaviour the owner asked for, and it is a surprise worth spending
          a sentence on: the merchant may reasonably want to wait for a quiet hour to do it.
        */}
        {mode === 'edit' && offer?.status === 'approved' && askingCents !== offer.askingPriceCents && (
          <Alert tone="warning">{t('priceReturnsToReview')}</Alert>
        )}

        {askingAboveDue && (
          <Alert tone="warning">
            {t('askingAboveDue', {
              asking: formatPrice(askingCents, locale),
              due: formatPrice(dueCents, locale),
            })}
          </Alert>
        )}

        {mode === 'create' && (
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              name="submitNow"
              defaultChecked
              className="mt-0.5 size-4 accent-forest-700"
            />
            <span>
              {t('submitNow')}
              <span className="block text-[13px] text-ink-500">{t('submitNowHint')}</span>
            </span>
          </label>
        )}

        {state && !state.ok && (
          <Alert tone="error">{te(offerErrorLeaf(state.error), { max: maxHandlingDays })}</Alert>
        )}

        <div className="flex flex-wrap gap-2">
          <SubmitButton>{mode === 'create' ? t('create') : t('save')}</SubmitButton>
          <Button variant="ghost" onClick={() => router.push('/merchant/offers')}>
            {t('cancel')}
          </Button>
        </div>
      </form>

      {/* Submit-for-review and delete are separate forms: each is one verb with one outcome, and
          nesting them in the edit form would make Enter in the price field ambiguous. */}
      {mode === 'edit' && offer && <OfferSideActions offer={offer} />}
    </div>
  );
}

function OfferSideActions({ offer }: { offer: OfferRow }) {
  const t = useTranslations('merchant.offers.form');
  const te = useTranslations('merchant.offers.errors');
  const router = useRouter();

  const [submitState, submitAction] = useActionState<OfferState, FormData>(
    async (previous, formData) => setOfferStatus(previous, formData),
    null,
  );
  const [deleteState, deleteAction] = useActionState<OfferState, FormData>(
    async (previous, formData) => {
      const result = await deleteOffer(previous, formData);
      if (result?.ok) router.push('/merchant/offers');
      return result;
    },
    null,
  );

  const canSubmit = offer.status === 'draft' || offer.status === 'rejected';
  const canDelete = offer.status === 'draft' || offer.status === 'rejected';

  if (!canSubmit && !canDelete) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5">
      {canSubmit && (
        <form action={submitAction} className="flex flex-col gap-2">
          <input type="hidden" name="offerId" value={offer.id} />
          <input type="hidden" name="status" value="pending_review" />
          <div>
            <SubmitButton size="sm">{t('submitForReview')}</SubmitButton>
          </div>
          <p className="text-[13px] text-ink-500">{t('submitForReviewHint')}</p>
          {submitState && !submitState.ok && (
            <Alert tone="error">{te(offerErrorLeaf(submitState.error))}</Alert>
          )}
        </form>
      )}

      {canDelete && (
        <form action={deleteAction} className="flex flex-col gap-2">
          <input type="hidden" name="offerId" value={offer.id} />
          <div>
            <SubmitButton size="sm" variant="destructive">
              <Trash2 className="size-3.5" aria-hidden="true" />
              {t('delete')}
            </SubmitButton>
          </div>
          {/* Only drafts and rejections can go — an approved offer is paused, never removed,
              because it may already have sourced an order. The RLS policy is the authority. */}
          <p className="text-[13px] text-ink-500">{t('deleteHint')}</p>
          {deleteState && !deleteState.ok && (
            <Alert tone="error">{te(offerErrorLeaf(deleteState.error))}</Alert>
          )}
        </form>
      )}
    </div>
  );
}
