'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One audit entry, with its before/after available on demand.
 *
 * The diff is passed in **already serialised**. `before` and `after` are arbitrary jsonb, and
 * handing arbitrary objects to a client component means whatever ends up in them ends up in the
 * RSC payload — including, one day, a field somebody added to an audit row without thinking about
 * who reads it. Serialising on the server keeps this component dumb and the payload predictable.
 *
 * Side by side rather than a computed line diff: these are small objects, and a real diff library
 * for four keys is weight on a page only admins open.
 */
export function AuditRowView({
  action,
  entityType,
  entityId,
  actorEmail,
  actorRole,
  ip,
  createdAt,
  displayDate,
  utcDate,
  before,
  after,
}: {
  action: string;
  entityType: string;
  entityId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  ip: string | null;
  createdAt: string;
  displayDate: string;
  utcDate: string;
  before: string;
  after: string;
}) {
  const [open, setOpen] = useState(false);
  const hasDiff = before !== 'null' || after !== 'null';

  return (
    <li className="rounded-sm border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        disabled={!hasDiff}
        className={cn(
          'flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm',
          hasDiff ? 'hover:bg-forest-50' : 'cursor-default',
        )}
      >
        <ChevronRight
          className={cn(
            'size-4 shrink-0 text-ink-500 transition-transform',
            open && 'rotate-90',
            !hasDiff && 'invisible',
          )}
          aria-hidden="true"
        />
        <span className="font-mono text-xs text-forest-800">{action}</span>
        <span className="text-ink-600">{entityType.replace(/_/g, ' ')}</span>
        <span className="ml-auto text-xs text-ink-600">
          {/* A null actor is the cron, a webhook or the service role — named, not left blank. */}
          {actorEmail ?? `System${actorRole ? ` (${actorRole})` : ''}`}
        </span>
        <time
          dateTime={createdAt}
          title={utcDate}
          className="shrink-0 text-xs text-ink-500"
          data-numeric
        >
          {displayDate}
        </time>
      </button>

      {open && (
        <div className="border-t border-line px-3 py-3">
          <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-600">
            {entityId && (
              <div>
                <dt className="inline font-medium">Record: </dt>
                <dd className="inline font-mono">{entityId}</dd>
              </div>
            )}
            {ip && (
              <div>
                <dt className="inline font-medium">From: </dt>
                <dd className="inline font-mono">{ip}</dd>
              </div>
            )}
          </dl>

          <div className="grid gap-3 sm:grid-cols-2">
            <DiffPane label="Before" json={before} />
            <DiffPane label="After" json={after} />
          </div>
        </div>
      )}
    </li>
  );
}

function DiffPane({ label, json }: { label: string; json: string }) {
  return (
    <div>
      <p className="font-ui text-[11px] font-semibold text-ink-500 uppercase">{label}</p>
      <pre className="mt-1 max-h-64 overflow-auto rounded-sm border border-line bg-cream p-2 font-mono text-[11px] text-ink-900">
        {json === 'null' ? '—' : json}
      </pre>
    </div>
  );
}
