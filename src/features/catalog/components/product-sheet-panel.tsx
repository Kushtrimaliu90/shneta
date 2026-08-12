'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, Check, Download, Upload, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ImportPlan } from '@/features/catalog/sheet-import';

/**
 * Download the catalogue, edit it in Excel, upload it back.
 *
 * ── Why the file is uploaded twice ──
 *
 * The first upload previews; the second, after the operator confirms, writes. Nothing is carried between
 * them — the server re-reads the same file and re-diffs it against current data both times. So a diff cannot
 * be applied against a catalogue that has moved on since it was shown, and there is no posted plan to
 * tamper with. The file is still in the input, so re-sending it costs the operator nothing and me one
 * `fetch`.
 *
 * ── Why a preview at all ──
 *
 * Because one mistyped column can reprice the catalogue. Every other bulk action in this panel is either
 * reversible or reports what it skipped; a price change is neither — the old value only exists in the audit
 * log. Showing the diff first turns "I hope that was right" into a decision.
 */
export function ProductSheetPanel() {
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function send(apply: boolean) {
    const file = input.current?.files?.[0];
    if (!file) {
      setError('Choose the edited file first.');
      return;
    }

    setBusy(apply ? 'apply' : 'preview');
    setError(null);
    if (!apply) setPlan(null);

    try {
      const body = new FormData();
      body.set('file', file);
      const response = await fetch(`/admin/products/sheet${apply ? '?apply=1' : ''}`, {
        method: 'POST',
        body,
      });
      const payload = (await response.json()) as
        | { ok: true; plan: ImportPlan }
        | { ok: false; error?: string };

      if (!payload.ok) {
        setError(payload.error ?? 'That did not work.');
        setPlan(null);
        return;
      }
      setPlan(payload.plan);
      setFilename(file.name);
    } catch {
      setError('The upload did not complete. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  const changeCount = plan ? plan.products.length + plan.variants.length : 0;

  return (
    <details className="rounded-lg border border-line bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-900">
        Edit in Excel
        <span className="ml-2 font-normal text-ink-600">
          download the catalogue, change what you need, upload it back
        </span>
      </summary>

      <div className="flex flex-col gap-4 border-t border-line p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/*
            A plain `<a>`, not `next/link`, and not a fetch.

            The response is a file with a `Content-Disposition`, so the browser saves it — and a link is what
            makes middle-click and "save as" work, which a button would not. `next/link` is wrong here for a
            more specific reason: `/admin/products/sheet` is a **route handler**, not a page, so client
            navigation would try to render it as one. The lint rule cannot tell the two apart from the path.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/admin/products/sheet"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-sm bg-forest-800 px-3.5 text-sm font-medium text-white hover:bg-forest-700"
          >
            <Download className="size-4" aria-hidden="true" />
            Download the catalogue
          </a>
          <p className="text-xs text-ink-600">
            Every product and variant, with a sheet explaining the rules.
          </p>
        </div>

        <div className="border-t border-line pt-4">
          <label htmlFor="sheet-file" className="block text-xs font-medium text-ink-900">
            Upload the edited file
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              ref={input}
              id="sheet-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={() => {
                // A new file invalidates whatever diff is on screen — it was about the old one.
                setPlan(null);
                setError(null);
              }}
              className="text-sm"
            />
            <Button type="button" size="sm" onClick={() => send(false)} disabled={busy !== null}>
              <Upload className="size-3.5" aria-hidden="true" />
              {busy === 'preview' ? 'Reading…' : 'See what would change'}
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-ink-600">
            Nothing is saved until you confirm. A column you delete from the file is left alone; a cell you
            empty in a column you kept is cleared.
          </p>
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        {plan && (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'rounded-lg border p-4 text-sm',
              plan.applied
                ? 'border-forest-500/40 bg-forest-50/50'
                : changeCount === 0
                  ? 'border-warning/40 bg-warning/5'
                  : 'border-line bg-cream',
            )}
          >
            <p className="flex items-start gap-2 font-medium text-ink-900">
              {plan.applied ? (
                <Check className="mt-0.5 size-4 shrink-0 text-forest-700" aria-hidden="true" />
              ) : changeCount === 0 ? (
                <X className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-ink-600" aria-hidden="true" />
              )}
              {plan.applied
                ? `Saved. ${changeCount} row${changeCount === 1 ? '' : 's'} updated.`
                : changeCount === 0
                  ? 'Nothing would change.'
                  : `${changeCount} row${changeCount === 1 ? '' : 's'} would change.`}
              {plan.unchanged > 0 && (
                <span className="font-normal text-ink-600">
                  {' '}
                  {plan.unchanged} row{plan.unchanged === 1 ? '' : 's'} already match.
                </span>
              )}
            </p>

            {filename && <p className="mt-0.5 text-xs text-ink-500">{filename}</p>}

            {/*
              The diff, field by field. This is the whole reason there is a preview — a count would tell an
              operator that something is about to happen without telling them what.
            */}
            {changeCount > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {[...plan.products, ...plan.variants].map((row) => (
                  <li key={`${row.row}-${row.label}`} className="text-ink-900">
                    <span className="font-medium">{row.label}</span>
                    <ul className="mt-0.5 flex flex-col gap-0.5 pl-4 text-xs text-ink-600">
                      {row.changes.map((change) => (
                        <li key={change.field}>
                          {change.field}:{' '}
                          <span className="text-error line-through">{change.from || '(empty)'}</span>{' '}
                          →{' '}
                          <span className="font-medium text-forest-800">
                            {change.to || '(empty)'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}

            {plan.problems.length > 0 && (
              <>
                <p className="mt-3 font-medium text-ink-900">
                  {plan.problems.length} row{plan.problems.length === 1 ? '' : 's'} could not be used:
                </p>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                  {plan.problems.map((problem) => (
                    <li key={`${problem.sheet}-${problem.row}-${problem.label}`} className="text-ink-600">
                      <span className="font-medium text-ink-900">
                        {problem.sheet} row {problem.row} · {problem.label}
                      </span>{' '}
                      — {problem.problem}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-ink-600">
                  {/*
                    Said plainly, because "3 rows failed" next to a Save button invites the assumption that
                    saving fixes them.
                  */}
                  Confirming saves the rows above and leaves these as they are.
                </p>
              </>
            )}

            {!plan.applied && changeCount > 0 && (
              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => send(true)}
                  disabled={busy !== null}
                >
                  {busy === 'apply' ? 'Saving…' : `Save these ${changeCount} changes`}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPlan(null)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
