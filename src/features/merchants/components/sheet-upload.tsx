'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';

/**
 * "Choose your Excel file" in front of the paste box that used to be the only way in.
 *
 * ── Why it fills the textarea rather than replacing it ──
 *
 * The delimited-text parsers are the tested part of this feature: 39 and 25 unit cases covering
 * semicolons, tabs, a BOM, CRLF, quoted fields and bilingual header aliases. Uploading converts the
 * spreadsheet to the one shape they read unambiguously and puts it in the box, so the file path and the
 * paste path meet immediately and share every downstream check, cap and error message. A second
 * submission route would be a second thing to keep correct.
 *
 * The visible consequence is the useful one: the merchant sees what was read before submitting. A sheet
 * whose header row is a title, or whose stock column is named something we do not recognise, is
 * obvious on screen rather than after a write.
 *
 * ── Why the file goes to a route handler ──
 *
 * A Server Action body is capped at 1 MB and a real spreadsheet is not. `/api/merchant/sheet` reads and
 * returns text; it writes nothing.
 */
/**
 * The reasons the route can return, listed rather than interpolated.
 *
 * next-intl types its keys, so a template string does not compile — which is a feature here. An
 * unrecognised reason falls back to the generic message instead of rendering a raw key or, worse, a
 * different and specific wrong one, which is exactly the failure the bulk form's skip list had.
 */
const REASONS = [
  'unreadable',
  'empty',
  'no_rows',
  'too_many_rows',
  'too_large',
  'wrong_type',
  'forbidden',
] as const;

function reasonKey(
  reason: string | undefined,
):
  | 'errors.unreadable'
  | 'errors.empty'
  | 'errors.no_rows'
  | 'errors.too_many_rows'
  | 'errors.too_large'
  | 'errors.wrong_type'
  | 'errors.forbidden' {
  const match = REASONS.find((candidate) => candidate === reason);
  return `errors.${match ?? 'unreadable'}` as 'errors.unreadable';
}

export function SheetUpload({ targetId }: { targetId: string }) {
  const t = useTranslations('merchant.sheet');
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  const send = async (file: File) => {
    const body = new FormData();
    body.set('file', file);

    try {
      const response = await fetch('/api/merchant/sheet', { method: 'POST', body });
      const data = (await response.json()) as {
        ok?: boolean;
        text?: string;
        rowCount?: number;
        reason?: string;
      };

      if (!response.ok || !data.ok || typeof data.text !== 'string') {
        setStatus({ kind: 'error', message: t(reasonKey(data.reason)) });
        return;
      }

      const target = document.getElementById(targetId);
      if (target instanceof HTMLTextAreaElement) {
        target.value = data.text;
        // React does not see a direct value assignment, and the form reads the DOM node on submit.
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      setStatus({ kind: 'ok', message: t('read', { rows: data.rowCount ?? 0 }) });
    } catch {
      setStatus({ kind: 'error', message: t('errors.unreadable') });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${targetId}-file`} className="text-sm font-medium text-ink-900">
        {t('label')}
      </label>
      <p className="text-[13px] text-ink-600">{t('hint')}</p>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          id={`${targetId}-file`}
          type="file"
          accept=".xlsx,.csv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setStatus(null);
            startTransition(() => {
              void send(file);
            });
            // Cleared so choosing the same filename twice still fires a change.
            event.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={pending}
          className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-line-strong px-4 text-sm font-medium text-forest-800 hover:bg-forest-50 disabled:opacity-60"
        >
          <Upload className="size-4" aria-hidden="true" />
          {pending ? t('reading') : t('choose')}
        </button>

        {status && (
          <p
            // `alert` so the outcome is announced: the result of the pick is the whole feedback.
            role={status.kind === 'error' ? 'alert' : 'status'}
            className={status.kind === 'error' ? 'text-sm text-red-700' : 'text-sm text-forest-800'}
          >
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}
