'use client';

import { useActionState, useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { submitProposalBatch, type BatchState } from '@/features/merchants/batch-actions';
import { SheetUpload } from '@/features/merchants/components/sheet-upload';

const LEAVES = [
  'generic',
  'invalid',
  'notMerchant',
  'empty',
  'noHeader',
  'tooMany',
  'tooManyOpen',
] as const;
type Leaf = (typeof LEAVES)[number];

function leaf(error: string): Leaf {
  const last = error.split('.').pop() ?? 'generic';
  return (LEAVES as readonly string[]).includes(last) ? (last as Leaf) : 'generic';
}

const REASONS = [
  'incomplete',
  'no_price',
  'negative_stock',
  'duplicate_in_sheet',
  'already_proposed',
  'bad_price',
  'bad_stock',
] as const;

function reasonKey(reason: string): (typeof REASONS)[number] {
  return (REASONS as readonly string[]).includes(reason)
    ? (reason as (typeof REASONS)[number])
    : 'incomplete';
}

/**
 * docs/16 §9.1 — pasting a catalogue of products BioCode does not list.
 *
 * ── Why the merchant is sent onwards on success ──
 *
 * The rows are only half of a proposal: the photographs are what let a reviewer see the product exists, and
 * they attach by filename on the batch's own page. Landing back on this form with a "created 187" message
 * would leave a merchant thinking it was finished. `router.push` to the batch is the next step, stated by
 * happening.
 *
 * The report still renders, because a paste of 200 rows where 13 were refused has to say which 13 and why
 * before anyone moves on — so the redirect waits for a batch id and the failures are shown either way.
 */
export function BatchForm() {
  const t = useTranslations('merchant.batches');
  const router = useRouter();

  /*
   * The sheet survives the submit.
   *
   * React 19 resets an uncontrolled form once its action resolves, so the textarea emptied the moment the
   * report appeared — and the report is a list of row numbers. "Rreshti 47 — çmimi nuk lexohet" against
   * text that is gone is unactionable, and it is the third time this exact reset has been fixed in this
   * codebase (the hero slide editor and the announcement bar were the first two).
   *
   * Held in state and echoed back as `defaultValue`, keyed so a *successful* submit still clears it —
   * leaving a sheet that has already been applied sitting in the box invites applying it twice.
   */
  const [sheet, setSheet] = useState('');

  const [state, action] = useActionState<BatchState, FormData>(async (previous, formData) => {
    const result = await submitProposalBatch(previous, formData);
    /*
     * Only when nothing was refused. A merchant with thirteen bad rows needs to read them here, and a
     * navigation that happened before they could would hide the one thing this screen is for.
     */
    if (
      result?.ok &&
      result.data.batchId &&
      result.data.skipped.length === 0 &&
      result.data.malformed.length === 0
    ) {
      router.push(`/merchant/proposals/${result.data.batchId}`);
    }
    return result;
  }, null);

  return (
    <form
      action={action}
      className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5"
    >
      <div>
        <p className="text-sm text-ink-600">{t('formIntro')}</p>
        <p className="mt-2 rounded-md bg-cream p-3 font-ui text-[13px] text-ink-900">
          {t('headerExample')}
        </p>
        <p className="mt-1 text-[13px] text-ink-500">{t('columnsHint')}</p>
      </div>

      {/*
        The file picker sits above the paste box and fills it, so a merchant who keeps stock in an .xlsx
        never meets a delimiter — and still sees what was read before saving. Pasting still works, and
        both routes share every downstream check.
      */}
      <SheetUpload targetId="proposal-sheet" />

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-ink-900">{t('paste')}</span>
        <textarea
          id="proposal-sheet"
          name="csv"
          defaultValue={sheet}
          onChange={(event) => setSheet(event.target.value)}
          rows={10}
          required
          spellCheck={false}
          placeholder={
            'emri;marka;forma;varianti;barkod;kodi;stok;çmimi\nMagnesium Glycinate;Probe Labs;kapsula;120 kapsula;5099999999901;MG-120;24;14,90'
          }
          className="rounded-sm border border-line-strong bg-surface p-2.5 font-ui text-sm"
        />
        <span className="text-[13px] text-ink-500">{t('pasteHint')}</span>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-ink-900">{t('note')}</span>
        <textarea
          name="note"
          rows={2}
          className="rounded-sm border border-line-strong bg-surface p-2.5 text-sm"
        />
        <span className="text-[13px] text-ink-500">{t('noteHint')}</span>
      </label>

      {state?.ok && (
        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          <p className="text-sm font-medium text-success">
            {t('created', { count: state.data.created })}
          </p>

          {state.data.batchId && <p className="text-[13px] text-ink-600">{t('nextStepImages')}</p>}

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
                {state.data.skipped.map((entry, index) => (
                  <li key={`${entry.name}-${entry.reason}-${index}`}>
                    {entry.name} — {t(`reasons.${reasonKey(entry.reason)}`)}
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
