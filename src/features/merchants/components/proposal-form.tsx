'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { ActionForm } from '@/components/ui/action-form';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { submitProposal, type ProposalState } from '@/features/merchants/proposal-actions';
import {
  ProposalImages,
  type UploadedImage,
} from '@/features/merchants/components/proposal-images';

const LEAVES = ['generic', 'invalid', 'notMerchant', 'tooMany'] as const;
type Leaf = (typeof LEAVES)[number];

function leaf(error: string): Leaf {
  const last = error.split('.').pop() ?? 'generic';
  return (LEAVES as readonly string[]).includes(last) ? (last as Leaf) : 'generic';
}

/**
 * docs/16 §4 — proposing a product.
 *
 * The fields are chosen to answer a reviewer's question, which is not "what would the product page say?"
 * but **"is this worth listing, and can we verify it?"** So the form asks for a barcode and a source link
 * — the two things that let somebody check the product is real and legally importable — and for the stock
 * and asking price, which decide whether the margin works before anybody writes SEO copy.
 *
 * It also asks for **photographs** (docs/16 §9), which the reviewer looks at before deciding and which the
 * approved proposal carries onto the draft product. That is not the merchant writing a listing: a merchant
 * holding the box is the only party who can photograph it, whereas the description, the ingredients, the
 * warnings and the price belong to the canonical product BioCode writes if it agrees.
 */
export function ProposalForm({ merchantId }: { merchantId: string }) {
  const t = useTranslations('merchant.proposals');
  const [images, setImages] = useState<UploadedImage[]>([]);

  const [state, action] = useActionState<ProposalState, FormData>(async (previous, formData) => {
    const result = await submitProposal(previous, formData);
    // Clear the previews on success, or a merchant sees the photos of a proposal already sent.
    if (result?.ok) setImages([]);
    return result;
  }, null);

  return (
    <ActionForm
      action={action}
      state={state}
      className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5"
    >
      <p className="text-sm text-ink-600">{t('formIntro')}</p>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="productName" label={t('productName')} required>
          {(field) => <Input {...field} name="productName" autoComplete="off" />}
        </Field>

        <Field id="brandName" label={t('brandName')} required>
          {(field) => <Input {...field} name="brandName" autoComplete="off" />}
        </Field>

        <Field id="form" label={t('form')} hint={t('formHint')}>
          {(field) => <Input {...field} name="form" autoComplete="off" />}
        </Field>

        <Field id="variantName" label={t('variantName')} hint={t('variantNameHint')}>
          {(field) => <Input {...field} name="variantName" autoComplete="off" />}
        </Field>

        <Field id="barcode" label={t('barcode')} hint={t('barcodeHint')}>
          {(field) => <Input {...field} name="barcode" autoComplete="off" inputMode="numeric" />}
        </Field>

        <Field id="sourceUrl" label={t('sourceUrl')} hint={t('sourceUrlHint')}>
          {(field) => <Input {...field} name="sourceUrl" type="url" autoComplete="off" />}
        </Field>

        <Field id="stockOnHand" label={t('stock')} hint={t('stockHint')} required>
          {(field) => (
            <Input {...field} name="stockOnHand" type="number" min={0} step={1} defaultValue={0} />
          )}
        </Field>

        <Field id="askingPriceEuro" label={t('asking2')} hint={t('askingHint')} required>
          {(field) => (
            <Input
              {...field}
              name="askingPriceEuro"
              type="text"
              inputMode="decimal"
              autoComplete="off"
            />
          )}
        </Field>

        {/*
          The rest of the offer, asked here so approval can mint it.

          Stock and asking price were already on this form — they are two of the five things an offer
          needs, and a reviewer needs them to judge whether the product is worth listing at all. The
          other three used to be re-typed into the offer form *after* approval, which for a 200-row
          batch was 200 forms for a decision the merchant had already made.

          Both carry defaults matching the offer table's own (3 and 1), so a merchant who ignores them
          still gets a working offer rather than a validation wall.
        */}
        <Field id="handlingDays" label={t('handling')} hint={t('handlingHint')}>
          {(field) => (
            <Input
              {...field}
              name="handlingDays"
              type="number"
              min={0}
              max={30}
              step={1}
              defaultValue={1}
            />
          )}
        </Field>

        <Field id="lowStockThreshold" label={t('threshold')} hint={t('thresholdHint')}>
          {(field) => (
            <Input
              {...field}
              name="lowStockThreshold"
              type="number"
              min={0}
              step={1}
              defaultValue={3}
            />
          )}
        </Field>

        <Field id="merchantSku" label={t('sku')} hint={t('skuHint')}>
          {(field) => <Input {...field} name="merchantSku" autoComplete="off" />}
        </Field>
      </div>

      <Field id="note" label={t('note')} hint={t('noteHint')} required>
        {(field) => (
          <textarea
            {...field}
            name="note"
            rows={3}
            minLength={10}
            className="rounded-sm border border-line-strong bg-surface p-2.5 text-sm"
          />
        )}
      </Field>

      <ProposalImages merchantId={merchantId} images={images} onChange={setImages} />

      {state?.ok && (
        <p role="status" aria-live="polite" className="text-sm font-medium text-success">
          {t('sent')}
        </p>
      )}
      {state && !state.ok && <Alert tone="error">{t(`errors.${leaf(state.error)}`)}</Alert>}

      <div>
        <SubmitButton>{t('submit')}</SubmitButton>
      </div>
    </ActionForm>
  );
}
