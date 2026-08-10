'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { bulkApplyOffers, type BulkState } from '@/features/merchants/bulk-actions';

const LEAVES = ['generic', 'notMerchant', 'empty', 'tooMany', 'noHeader'] as const;
type Leaf = (typeof LEAVES)[number];

function leaf(error: string): Leaf {
  const last = error.split('.').pop() ?? 'generic';
  return (LEAVES as readonly string[]).includes(last) ? (last as Leaf) : 'generic';
}

const SKIP_REASONS = [
  'no_sku',
  'no_matching_offer',
  'nothing_to_change',
  'negative_stock',
  'invalid_price',
  'bad_stock',
  'bad_price',
  // Bulk creation (§6.1): each one needs a different thing from the merchant, so each has its own line.
  'bad_handling',
  'bad_threshold',
  'invalid_handling',
  'invalid_threshold',
  'unknown_sku',
  'awaiting_review',
  'offer_rejected',
  'price_required',
  /* Migration-free addition: a number whose decimal separator cannot be determined. */
  'ambiguous_price',
  'too_many_columns',
  'unknown',
] as const;

type SkipReason = (typeof SKIP_REASONS)[number];

/*
 * An unrecognised reason becomes `unknown`, not `nothing_to_change`.
 *
 * The fallback used to name a specific, different problem — the merchant was told the row had nothing to
 * change when the database had said something else entirely, and went looking at a field that was fine.
 * A reason we cannot translate is better admitted than replaced with a confident wrong one.
 */
function reasonKey(reason: string): SkipReason {
  return (SKIP_REASONS as readonly string[]).includes(reason) ? (reason as SkipReason) : 'unknown';
}

/**
 * docs/16 §6 — bulk stock and price, from a paste.
 *
 * A textarea rather than a file input, because a merchant's actual workflow is "open the spreadsheet,
 * select the columns, copy" — which lands here with no upload, no multipart body and no client-side file
 * reader. The KYB documents are a file upload because there the file *is* the thing; here the numbers are.
 *
 * **The report is the feature.** A hundred-row paste where four rows are wrong has to say which four and
 * why, or the merchant re-uploads everything and hopes. Two kinds of failure are reported separately
 * because they have different fixes: rows this parser could not read at all, with line numbers matching
 * the spreadsheet, and rows the database declined to match to an offer.
 */
export function BulkForm() {
  const t = useTranslations('merchant.bulk');
  const [state, action] = useActionState<BulkState, FormData>(
    async (previous, formData) => bulkApplyOffers(previous, formData),
    null,
  );

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
    >
      <div>
        <p className="text-sm text-ink-600">{t('intro')}</p>
        {/* Stated because the alternative — guessing column order — would write prices into stock. */}
        <p className="mt-2 rounded-md bg-cream p-3 font-ui text-[13px] text-ink-900">
          {t('headerExample')}
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-ink-900">{t('paste')}</span>
        <textarea
          name="csv"
          rows={8}
          required
          spellCheck={false}
          placeholder={'sku;stok;çmimi\nSKU-1;12;9,90'}
          className="rounded-sm border border-line-strong bg-surface p-2.5 font-ui text-sm"
        />
        <span className="text-[13px] text-ink-500">{t('pasteHint')}</span>
      </label>

      {/*
        Creation off by default (§6.1).

        The nightly stock file is the common paste, and there a mistyped SKU must report itself rather
        than become an offer at a price nobody checked. Ticking this is the merchant saying "these are new".
      */}
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          name="create"
          className="mt-0.5 size-4 rounded-sm border-line-strong text-forest-700"
        />
        <span>
          <span className="font-medium text-ink-900">{t('createLabel')}</span>
          <span className="block text-[13px] text-ink-500">{t('createHint')}</span>
        </span>
      </label>

      {state?.ok && (
        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          <p className="text-sm font-medium text-success">
            {t('applied', { count: state.data.applied })}
            {state.data.created > 0 && ` · ${t('createdCount', { count: state.data.created })}`}
          </p>

          {state.data.created > 0 && <p className="text-[13px] text-ink-600">{t('createdNote')}</p>}

          {state.data.malformed.length > 0 && (
            <Alert tone="warning" title={t('malformedTitle')}>
              <ul className="mt-1 flex flex-col gap-0.5">
                {state.data.malformed.map((entry) => (
                  <li key={`${entry.line}-${entry.reason}`}>
                    {t('lineIs', { line: entry.line })} — {t(`reasons.${reasonKey(entry.reason)}`)}
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          {state.data.skipped.length > 0 && (
            <Alert tone="warning" title={t('skippedTitle')}>
              <ul className="mt-1 flex flex-col gap-0.5">
                {state.data.skipped.map((entry) => (
                  <li key={`${entry.sku}-${entry.reason}`}>
                    <span data-numeric>{entry.sku}</span> —{' '}
                    {t(`reasons.${reasonKey(entry.reason)}`)}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      )}

      {state && !state.ok && <Alert tone="error">{t(`errors.${leaf(state.error)}`)}</Alert>}

      <div>
        <SubmitButton>{t('submit')}</SubmitButton>
      </div>
    </form>
  );
}
