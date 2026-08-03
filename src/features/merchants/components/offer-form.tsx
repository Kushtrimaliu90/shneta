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
 * docs/16 §5 — one offer, created or edited.
 *
 * ── What the merchant is actually agreeing to, made visible ──
 *
 * The form shows **three numbers per variant** and the relationship between them, because the
 * relationship is the deal and hiding it would be the marketplace's central unfairness:
 *
 *   · the **retail price** BioCode charges the customer — not editable here, and not the merchant's
 *     to set: one product, one page, one price (§1);
 *   · the merchant's **asking price**, which is what it wants for the unit and what the buy box
 *     sorts on;
 *   · what **settlement pays**, which is the retail price less this merchant's commission.
 *
 * A merchant asking more than settlement pays is telling BioCode the margin does not work, and it is
 * better that they see that on this screen than discover it on a statement. The warning below says so
 * without blocking the submission — it may be exactly what they mean, and a rate can be renegotiated.
 */
export function OfferForm({
  mode,
  locale,
  variants,
  offer,
  settlementPerUnitCents,
  maxHandlingDays,
}: {
  mode: 'create' | 'edit';
  locale: Locale;
  /** The canonical catalogue, for the create form's picker. Empty when editing. */
  variants: CatalogVariantOption[];
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

  const [variantId, setVariantId] = useState(offer?.variantId ?? variants[0]?.variantId ?? '');
  const [asking, setAsking] = useState(offer ? fromCents(offer.askingPriceCents) : '');

  const [state, action] = useActionState<OfferState, FormData>(async (previous, formData) => {
    const result = mode === 'create'
      ? await createOffer(previous, formData)
      : await updateOffer(previous, formData);
    if (result?.ok) router.push('/merchant/offers');
    return result;
  }, null);

  const selectedVariant = variants.find((entry) => entry.variantId === variantId);
  const retailCents = offer?.retailPriceCents ?? selectedVariant?.retailPriceCents ?? 0;
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
                {variants.map((entry) => (
                  <option key={entry.variantId} value={entry.variantId}>
                    {entry.brandName} · {pickLocale(entry.productName, locale)}
                    {pickLocale(entry.variantName, locale)
                      ? ` — ${pickLocale(entry.variantName, locale)}`
                      : ''}{' '}
                    ({entry.sku})
                  </option>
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

        {retailCents > 0 && (
          <dl className="grid gap-3 rounded-lg border border-line bg-surface p-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                {t('retail')}
              </dt>
              <dd className="mt-0.5 font-medium text-ink-900" data-numeric>
                {formatPrice(retailCents, locale)}
              </dd>
              <p className="text-[13px] text-ink-500">{t('retailHint')}</p>
            </div>
            <div>
              <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                {t('due')}
              </dt>
              <dd className="mt-0.5 font-medium text-forest-900" data-numeric>
                {formatPrice(dueCents, locale)}
              </dd>
              <p className="text-[13px] text-ink-500">
                {t('dueHint', { pct: offer?.commissionPct ?? 0 })}
              </p>
            </div>
            <div>
              <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                {t('askingShort')}
              </dt>
              <dd className="mt-0.5 font-medium text-ink-900" data-numeric>
                {Number.isFinite(askingCents) && askingCents > 0
                  ? formatPrice(askingCents, locale)
                  : '—'}
              </dd>
              <p className="text-[13px] text-ink-500">{t('askingShortHint')}</p>
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
