'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, Check, HelpCircle } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { attachBatchImages } from '@/features/merchants/batch-actions';
import { filenameKeys, imageKey } from '@/features/merchants/proposal-csv';

/** Mirrors the bucket exactly, so an image accepted here cannot be refused on upload. */
const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = 'image/webp,image/jpeg,image/png,image/avif';
const MAX_FILES = 300;

/**
 * What this component needs about a row, and nothing more.
 *
 * No image count: the table on the same page already shows how many photographs each row has, and a second
 * copy of that number inside a client component that cannot refresh it would go stale the moment somebody
 * attaches one.
 */
export interface BatchImageRow {
  id: string;
  productName: string;
  barcode: string | null;
  merchantSku: string | null;
}

interface Pending {
  /** The storage path, which exists as soon as the file has landed. */
  path: string;
  name: string;
  preview: string;
  /** The row this photograph is for — matched from the filename, or chosen by hand. */
  proposalId: string | null;
}

/**
 * docs/16 §9.1 — three hundred photographs and two hundred rows, matched by filename.
 *
 * ── Why the filename is the key ──
 *
 * The alternative is a dropdown per photograph, which for a real catalogue is three hundred dropdowns and
 * nobody does it. A merchant photographing its stock already names the files after the thing in them —
 * `5099999999901.jpg` — because that is what a barcode scanner and a phone gallery leave you with. So the
 * filename is read as a key: the barcode first, then the merchant's own SKU.
 *
 * `8712345678901-2.jpg` is the second photograph of one product, so a trailing counter comes off. The whole
 * stem is tried first, in case a SKU genuinely ends in `-2` (`proposal-csv.ts` → `filenameKeys`).
 *
 * ── And why the unmatched list still exists ──
 *
 * Because matching will miss. A file called `IMG_4821.jpg` carries no key at all, and a merchant that
 * renamed half its photographs has half a job left. Those appear in their own list with a select — which is
 * the same dropdown as before, except only for the files that need it, which is usually a handful rather
 * than all of them.
 *
 * ── Uploaded first, attached second ──
 *
 * The bytes go from the browser to the private bucket as soon as they are chosen, and the *paths* are what
 * the server action receives. A server action's body is capped at 1 MB; three hundred phone photographs are
 * not going through it (§9).
 */
export function BatchImages({
  batchId,
  merchantId,
  rows,
}: {
  batchId: string;
  merchantId: string;
  rows: BatchImageRow[];
}) {
  const t = useTranslations('merchant.batches.images');
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attached, setAttached] = useState<number | null>(null);

  /*
   * A ref alongside the state, only so the unmount cleanup can see the *current* list.
   *
   * An effect with `[pending]` would revoke on every keystroke of the assign list; an effect with `[]` closes
   * over the empty first render. The ref is the standard way out, and it is written where the state is so the
   * two cannot drift.
   */
  const pendingRef = useRef<Pending[]>([]);
  pendingRef.current = pending;

  /** Every key any row answers to, pointing at that row. Built once per row list, not per file. */
  const keyed = useMemo(() => {
    const index = new Map<string, string>();
    for (const row of rows) {
      for (const candidate of [
        imageKey(row.barcode ?? undefined),
        imageKey(row.merchantSku ?? undefined),
      ]) {
        // First row wins a contested key: a duplicate barcode across rows is the sheet's problem, not this
        // component's, and silently attaching to the later row would hide it.
        if (candidate && !index.has(candidate)) index.set(candidate, row.id);
      }
    }
    return index;
  }, [rows]);

  function match(filename: string): string | null {
    for (const key of filenameKeys(filename)) {
      const found = keyed.get(key);
      if (found) return found;
    }
    return null;
  }

  async function upload(files: FileList | null): Promise<void> {
    setError(null);
    setAttached(null);
    if (!files || files.length === 0) return;

    const room = MAX_FILES - pending.length;
    if (room <= 0) {
      setError(t('errors.tooMany', { max: MAX_FILES }));
      return;
    }

    const chosen = Array.from(files).slice(0, room);
    setBusy(true);

    try {
      // Imported here, not at module scope: the browser client is 80 kB (see `document-upload.tsx`).
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const added: Pending[] = [];
      let failures = 0;

      for (const file of chosen) {
        if (file.size > MAX_BYTES) {
          failures += 1;
          continue;
        }

        const safeName = file.name
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-zA-Z0-9._-]/g, '-')
          .slice(-60);
        const path = `proposals/${merchantId}/${Date.now()}-${added.length}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from('merchant-proposals')
          .upload(path, file, { upsert: false, contentType: file.type });

        if (uploadError) {
          failures += 1;
          continue;
        }

        added.push({
          path,
          name: file.name,
          preview: URL.createObjectURL(file),
          // Matched on the *original* filename, not the sanitised storage name.
          proposalId: match(file.name),
        });
      }

      if (failures > 0) setError(t('errors.someFailed', { count: failures }));
      if (added.length > 0) setPending((current) => [...current, ...added]);
    } finally {
      setBusy(false);
    }
  }

  /*
   * And on the way off the screen, for the merchant who uploads three hundred photographs and then navigates
   * away without attaching them. Same reason as above: a blob URL pins its file in memory.
   */
  useEffect(() => {
    return () => {
      for (const entry of pendingRef.current) URL.revokeObjectURL(entry.preview);
    };
  }, []);

  async function attach(): Promise<void> {
    const assignments = pending
      .filter((entry): entry is Pending & { proposalId: string } => entry.proposalId !== null)
      .map((entry) => ({ proposalId: entry.proposalId, path: entry.path }));

    if (assignments.length === 0) {
      setError(t('errors.nothingMatched'));
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await attachBatchImages({ batchId, assignments });
      if (!result?.ok) {
        setError(t('errors.attachFailed'));
        return;
      }

      setAttached(result.data.attached);

      /*
       * Only the attached ones leave the list; anything still unassigned stays visible to be dealt with.
       *
       * Their preview URLs are **revoked** on the way out. A blob URL holds its `File` in memory, and this
       * screen is built for three hundred of them at up to 2 MB each — well over half a gigabyte retained
       * until the tab closes, on a phone, which is where a merchant photographing its own stock will be.
       */
      setPending((current) => {
        for (const entry of current) {
          if (entry.proposalId !== null) URL.revokeObjectURL(entry.preview);
        }
        return current.filter((entry) => entry.proposalId === null);
      });
    } finally {
      setBusy(false);
    }
  }

  const matched = pending.filter((entry) => entry.proposalId !== null);
  const unmatched = pending.filter((entry) => entry.proposalId === null);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-ink-600">{t('intro')}</p>
        <p className="mt-1 text-[13px] text-ink-500">{t('namingHint')}</p>
      </div>

      <div>
        <label htmlFor="batch-images" className="sr-only">
          {t('choose')}
        </label>
        <input
          id="batch-images"
          type="file"
          accept={ACCEPT}
          multiple
          disabled={busy}
          onChange={(event) => void upload(event.target.files)}
          className="hidden"
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => document.getElementById('batch-images')?.click()}
        >
          <ImagePlus className="size-4" aria-hidden="true" />
          {busy ? t('uploading') : t('choose')}
        </Button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {attached !== null && (
        <p role="status" aria-live="polite" className="text-sm font-medium text-success">
          {t('attached', { count: attached })}
        </p>
      )}

      {matched.length > 0 && (
        <section aria-labelledby="matched" className="flex flex-col gap-2">
          <h4 id="matched" className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
            <Check className="size-4 text-success" aria-hidden="true" />
            {t('matchedTitle', { count: matched.length })}
          </h4>
          <ul className="flex flex-wrap gap-2">
            {matched.map((entry) => {
              const row = rows.find((candidate) => candidate.id === entry.proposalId);
              return (
                <li
                  key={entry.path}
                  className="flex w-40 flex-col gap-1 rounded-md border border-line p-2"
                >
                  {/* A local blob URL, so `next/image` has nothing to optimise and cannot fetch it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={entry.preview}
                    alt={t('previewAlt', { name: entry.name })}
                    className="h-20 w-full rounded-sm object-cover"
                  />
                  <span className="truncate font-ui text-[11px] text-ink-500">{entry.name}</span>
                  <span className="truncate text-[13px] text-ink-900">
                    {row?.productName ?? '—'}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {unmatched.length > 0 && (
        <section aria-labelledby="unmatched" className="flex flex-col gap-2">
          <h4 id="unmatched" className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
            <HelpCircle className="size-4 text-warning" aria-hidden="true" />
            {t('unmatchedTitle', { count: unmatched.length })}
          </h4>
          <p className="text-[13px] text-ink-500">{t('unmatchedHint')}</p>

          <ul className="flex flex-col gap-2">
            {unmatched.map((entry) => (
              <li
                key={entry.path}
                className="flex flex-wrap items-center gap-3 rounded-md border border-line p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.preview}
                  alt={t('previewAlt', { name: entry.name })}
                  className="size-14 rounded-sm border border-line object-cover"
                />
                <span className="min-w-0 flex-1 truncate font-ui text-[13px] text-ink-600">
                  {entry.name}
                </span>

                <label className="flex items-center gap-2 text-sm">
                  <span className="sr-only">{t('assignTo', { name: entry.name })}</span>
                  <select
                    value=""
                    onChange={(event) => {
                      const proposalId = event.target.value || null;
                      setPending((current) =>
                        current.map((candidate) =>
                          candidate.path === entry.path ? { ...candidate, proposalId } : candidate,
                        ),
                      );
                    }}
                    className="min-h-11 max-w-[16rem] rounded-md border border-line-strong bg-surface px-2 text-sm"
                  >
                    <option value="">{t('assignPlaceholder')}</option>
                    {rows.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.productName}
                        {row.barcode ? ` · ${row.barcode}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {matched.length > 0 && (
        <div>
          <Button onClick={() => void attach()} disabled={busy}>
            {t('attach', { count: matched.length })}
          </Button>
        </div>
      )}
    </div>
  );
}
