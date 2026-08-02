import Link from 'next/link';
import type { Metadata } from 'next';
import { ScrollText } from 'lucide-react';
import { formatAdminDateTime } from '@/features/admin/copy';
import { AUDIT_PAGE_SIZE, listAudit, listAuditEntityTypes } from '@/features/settings/queries';
import { AuditRowView } from '@/features/settings/components/audit-row';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Audit log' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

/**
 * docs/06 §15 — the audit log, with a diff viewer.
 *
 * Admin only, by `p_admin_read on audit_logs`. Read-only with no delete anywhere: a log an
 * operator can edit answers no question worth asking, and `log_audit` stamps the actor from
 * `auth.uid()` rather than from anything a caller passes, so a row cannot be forged either.
 */
export default async function AdminAuditPage({ searchParams }: Props) {
  const params = await searchParams;

  const actor = first(params.actor);
  const entityType = first(params.entity);
  const from = first(params.from);
  const to = first(params.to);
  const before = first(params.before);

  const [{ rows, nextCursor }, entityTypes] = await Promise.all([
    listAudit({ actor, entityType, from, to, before }),
    listAuditEntityTypes(),
  ]);

  function href(next: { entity?: string; before?: string }): string {
    const query = new URLSearchParams();
    const nextEntity = 'entity' in next ? next.entity : entityType;
    if (actor) query.set('actor', actor);
    if (nextEntity) query.set('entity', nextEntity);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    if (next.before) query.set('before', next.before);
    const qs = query.toString();
    return qs ? `/admin/settings/audit?${qs}` : '/admin/settings/audit';
  }

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-carbon-900">Audit log</h2>
      <p className="mt-0.5 mb-4 max-w-2xl text-sm text-ink-600">
        Every change made from the panel: who, what, when, and what the values were before and
        after. Nothing here can be edited or removed.
      </p>

      <nav aria-label="Filter by record type" className="flex flex-wrap gap-1.5">
        {[undefined, ...entityTypes].map((value) => {
          const active = value === entityType;
          return (
            <Link
              key={value ?? 'all'}
              href={href({ entity: value })}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-8 items-center rounded-sm border px-2.5 text-xs transition-colors',
                active
                  ? 'border-carbon-800 bg-carbon-100 font-medium text-carbon-900'
                  : 'border-line-strong text-ink-600 hover:bg-carbon-50',
              )}
            >
              {value ? value.replace(/_/g, ' ') : 'All'}
            </Link>
          );
        })}
      </nav>

      <form action="/admin/settings/audit" className="mt-3 flex flex-wrap items-end gap-2">
        {entityType && <input type="hidden" name="entity" value={entityType} />}
        <div>
          <label htmlFor="actor" className="block text-xs font-medium text-ink-900">
            Who
          </label>
          <input
            id="actor"
            name="actor"
            defaultValue={actor ?? ''}
            placeholder="Email"
            className="mt-1 h-9 w-48 rounded-sm border border-line-strong bg-surface px-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-ink-900">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from ?? ''}
            className="mt-1 h-9 rounded-sm border border-line-strong bg-surface px-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-ink-900">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to ?? ''}
            className="mt-1 h-9 rounded-sm border border-line-strong bg-surface px-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="h-9 rounded-sm border border-line-strong px-3 text-sm text-ink-900 hover:bg-carbon-50"
        >
          Apply
        </button>
        {(actor || from || to) && (
          <Link
            href={href({ entity: entityType })}
            className="h-9 px-2 py-1.5 text-sm text-carbon-800 underline underline-offset-4"
          >
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <ScrollText className="mx-auto size-6 text-ink-500" aria-hidden="true" />
          <p className="mt-2 font-medium text-carbon-900">Nothing matches</p>
          <p className="mt-1.5 text-sm text-ink-600">
            {actor
              ? 'The “who” filter matches the visible page only — try clearing it and narrowing by date instead.'
              : 'Widen the dates, or clear the filters.'}
          </p>
        </div>
      ) : (
        <>
          <ul className="mt-6 flex flex-col gap-1.5">
            {rows.map((row) => {
              const when = formatAdminDateTime(row.createdAt);
              return (
                <AuditRowView
                  key={row.id}
                  action={row.action}
                  entityType={row.entityType}
                  entityId={row.entityId}
                  actorEmail={row.actorEmail}
                  actorRole={row.actorRole}
                  ip={row.ip}
                  createdAt={row.createdAt}
                  displayDate={when.display}
                  utcDate={when.utc}
                  before={JSON.stringify(row.before ?? null, null, 2)}
                  after={JSON.stringify(row.after ?? null, null, 2)}
                />
              );
            })}
          </ul>

          {nextCursor && (
            <div className="mt-4 flex justify-center">
              <Link
                href={href({ before: nextCursor })}
                className="inline-flex h-9 items-center rounded-sm border border-line-strong px-4 text-sm text-ink-900 hover:bg-carbon-50"
              >
                Older entries
              </Link>
            </div>
          )}
          <p className="mt-2 text-center text-xs text-ink-500">
            <span data-numeric>{rows.length}</span> of up to{' '}
            <span data-numeric>{AUDIT_PAGE_SIZE}</span> per page
          </p>
        </>
      )}
    </section>
  );
}
