'use client';

import { useActionState, useState } from 'react';
import { CheckCircle2, Clock, FileEdit, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { storageUrl } from '@/lib/storage';
import { deletePlacement, setPlacementStatus } from '@/features/placements/admin-actions';
import type { AdminPlacement, PlacementDay } from '@/features/placements/admin-queries';
import { PlacementEditor } from '@/features/placements/components/placement-editor';
import { cn } from '@/lib/utils';

/**
 * docs/06 — the sponsored slots console.
 *
 * Admin UI is English-only in v1 (CLAUDE.md §3); the *content* it edits is bilingual and every text
 * field appears as an SQ/EN pair.
 *
 * ── The list is the review queue ──
 *
 * Status is the organising idea rather than an attribute buried in a row: nothing merchant-supplied
 * reaches a shopper without somebody approving it, so approving has to be one click from a list that
 * shows the creative, the advertiser and where it will run. Opening an editor to approve would blur
 * reviewing with editing, and the point of the workflow is that they are different acts.
 */

const STATUS_LABEL: Record<AdminPlacement['status'], string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  approved: 'Approved',
};

export function PlacementsAdmin({
  placements,
  days,
  range,
}: {
  placements: AdminPlacement[];
  days: PlacementDay[];
  range: { from: string; to: string };
}) {
  const [tab, setTab] = useState<'slots' | 'report'>('slots');
  const [editing, setEditing] = useState<AdminPlacement | 'new' | null>(null);

  return (
    <div className="mt-6">
      <div role="tablist" aria-label="Placements" className="flex gap-1 border-b border-line">
        {(['slots', 'report'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={
              tab === name
                ? 'border-b-2 border-forest-800 px-3 py-2 text-sm font-medium text-forest-900'
                : 'border-b-2 border-transparent px-3 py-2 text-sm text-ink-600 hover:text-ink-900'
            }
          >
            {name === 'slots' ? 'Slots' : 'Report'}
          </button>
        ))}
      </div>

      {tab === 'slots' ? (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-600">
              Approved placements run inside their dates and stop automatically. Expired ones stay
              here with their numbers.
            </p>
            <Button size="sm" onClick={() => setEditing('new')}>
              New placement
            </Button>
          </div>

          {placements.length === 0 && (
            <Alert tone="info">
              Nothing sold yet. The slot stays collapsed on the shop pages until a placement is
              approved — shoppers never see an empty box.
            </Alert>
          )}

          <ul className="flex flex-col gap-3">
            {placements.map((placement) => (
              <PlacementRow
                key={placement.id}
                placement={placement}
                onEdit={() => setEditing(placement)}
              />
            ))}
          </ul>

          {editing && (
            <PlacementEditor
              placement={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </div>
      ) : (
        <ReportPanel days={days} range={range} />
      )}
    </div>
  );
}

function StatusAction({
  id,
  status,
  label,
  children,
}: {
  id: string;
  status: AdminPlacement['status'];
  label: string;
  children: React.ReactNode;
}) {
  const [, formAction] = useActionState(setPlacementStatus, null);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton variant="ghost" size="sm" aria-label={label} title={label}>
        {children}
      </SubmitButton>
    </form>
  );
}

function PlacementRow({ placement, onEdit }: { placement: AdminPlacement; onEdit: () => void }) {
  const [deleteState, deleteAction] = useActionState(deletePlacement, null);
  const target =
    placement.targetCategorySlugs.length === 0 && placement.targetBrandSlugs.length === 0
      ? 'All listing pages'
      : [...placement.targetCategorySlugs, ...placement.targetBrandSlugs].join(', ');

  const src = placement.imageDesktopPath
    ? placement.imageDesktopPath.startsWith('/')
      ? placement.imageDesktopPath
      : storageUrl('content', placement.imageDesktopPath)
    : null;

  const ctr =
    placement.impressions > 0
      ? `${((placement.clicks / placement.impressions) * 100).toFixed(2)}%`
      : '—';

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3">
      <div className="h-12 w-40 shrink-0 overflow-hidden rounded-md border border-line bg-cream">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src && <img src={src} alt="" className="size-full object-cover" />}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink-900">
          {placement.advertiserName}
          {!placement.isPaid && (
            <span className="ml-2 rounded-sm bg-forest-50 px-1.5 py-0.5 text-xs font-normal text-forest-800">
              own brand
            </span>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <span
            className={cn(
              placement.status === 'approved' && 'text-success',
              placement.status === 'pending_review' && 'text-warning',
            )}
          >
            {STATUS_LABEL[placement.status]}
          </span>
          <span>· {target}</span>
          <span>· weight {placement.weight}</span>
          {placement.scheduledOut && <span className="text-warning">· outside its dates</span>}
        </p>
      </div>

      <div className="shrink-0 text-right text-xs text-ink-600" data-numeric>
        <p>{placement.impressions.toLocaleString()} impressions</p>
        <p>
          {placement.clicks.toLocaleString()} clicks · {ctr}
        </p>
      </div>

      <div className="flex items-center gap-0.5">
        {placement.status !== 'pending_review' && placement.status !== 'approved' && (
          <StatusAction id={placement.id} status="pending_review" label="Send for review">
            <Clock className="size-4" aria-hidden="true" />
          </StatusAction>
        )}
        {placement.status !== 'approved' && (
          <StatusAction id={placement.id} status="approved" label="Approve">
            <CheckCircle2 className="size-4" aria-hidden="true" />
          </StatusAction>
        )}
        {placement.status === 'approved' && (
          <StatusAction id={placement.id} status="draft" label="Take down">
            <FileEdit className="size-4" aria-hidden="true" />
          </StatusAction>
        )}

        <form action={deleteAction} className="inline">
          <input type="hidden" name="id" value={placement.id} />
          <SubmitButton
            variant="ghost"
            size="sm"
            aria-label="Delete"
            title="Delete, with its counts"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </SubmitButton>
        </form>

        <Button variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>

      {deleteState && !deleteState.ok && (
        <Alert tone="error" className="w-full">
          Could not delete that placement.
        </Alert>
      )}
    </li>
  );
}

function ReportPanel({
  days,
  range,
}: {
  days: PlacementDay[];
  range: { from: string; to: string };
}) {
  const totals = days.reduce(
    (acc, row) => ({
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
    }),
    { impressions: 0, clicks: 0 },
  );

  return (
    <div className="mt-4 flex flex-col gap-4">
      <form className="flex flex-wrap items-end gap-3" method="get">
        <label htmlFor="from" className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink-900">From</span>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={range.from}
            className="h-11 rounded-md border border-line bg-surface px-3 text-sm"
          />
        </label>
        <label htmlFor="to" className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink-900">To</span>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={range.to}
            className="h-11 rounded-md border border-line bg-surface px-3 text-sm"
          />
        </label>
        <SubmitButton size="sm">Apply</SubmitButton>

        {/*
          A GET link, not a client-side blob. The export is a server route, so it produces the same
          rows the table shows for the same range — one query, one answer, and nothing to disagree
          with the invoice.
        */}
        <a
          href={`/admin/placements/export?from=${range.from}&to=${range.to}`}
          className="inline-flex h-9 items-center rounded-md border border-line-strong px-3 text-sm text-ink-900 hover:bg-forest-50"
        >
          Export CSV
        </a>
      </form>

      <p className="text-sm text-ink-600" data-numeric>
        {totals.impressions.toLocaleString()} impressions · {totals.clicks.toLocaleString()} clicks
        ·{' '}
        {totals.impressions > 0
          ? `${((totals.clicks / totals.impressions) * 100).toFixed(2)}% CTR`
          : 'no CTR yet'}
      </p>

      {days.length === 0 ? (
        <Alert tone="info">No impressions recorded in this range.</Alert>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs tracking-wide text-ink-500 uppercase">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Day
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Advertiser
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Impressions
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Clicks
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  CTR
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map((row) => (
                <tr key={`${row.placementId}-${row.day}`} className="border-b border-line/60">
                  <td className="py-2 pr-4" data-numeric>
                    {row.day}
                  </td>
                  <td className="py-2 pr-4 text-ink-900">{row.advertiserName}</td>
                  <td className="py-2 pr-4 text-right" data-numeric>
                    {row.impressions}
                  </td>
                  <td className="py-2 pr-4 text-right" data-numeric>
                    {row.clicks}
                  </td>
                  <td className="py-2 text-right" data-numeric>
                    {row.impressions > 0
                      ? `${((row.clicks / row.impressions) * 100).toFixed(2)}%`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
