'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  adminRevokeApiKey,
  adminSetWebhookStatus,
  type ApiAdminState,
} from '@/features/merchants/api-admin-actions';
import type { AdminApiKeyRow, AdminWebhookRow } from '@/features/merchants/api-admin-queries';

/**
 * docs/18 §5 — the admin's view of every merchant's API: keys and webhook endpoints.
 *
 * English-only, as the whole admin panel is (CLAUDE.md §3). The buttons render only for a caller
 * with `merchants.manage`; the action re-checks it, because a server action is reachable by POST
 * without the page ever being drawn.
 */

const format = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

const ERRORS: Record<string, string> = {
  'admin.errors.forbidden': 'You do not have permission to do that.',
  'admin.errors.generic': 'Something went wrong. Try again.',
};

export function AdminApiKeysTable({
  keys,
  canManage,
}: {
  keys: AdminApiKeyRow[];
  canManage: boolean;
}) {
  if (keys.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
        No keys match this filter.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="bg-cream text-left text-xs text-ink-600 uppercase">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Merchant
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Key
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Scopes
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Created
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Last used
            </th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key.id} className={key.revokedAt ? 'text-ink-400' : 'text-ink-900'}>
              <td className="px-3 py-2">{key.merchantName}</td>
              <td className="px-3 py-2">
                <div>{key.name}</div>
                <div className="font-mono text-xs text-ink-600">{key.prefix}…</div>
              </td>
              <td className="px-3 py-2">
                <ul className="flex max-w-xs flex-wrap gap-1">
                  {key.scopes.map((scope) => (
                    <li
                      key={scope}
                      className="rounded-sm border border-line bg-cream px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      {scope}
                    </li>
                  ))}
                </ul>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {format.format(new Date(key.createdAt))}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {key.lastUsedAt ? format.format(new Date(key.lastUsedAt)) : 'Never'}
              </td>
              <td className="px-3 py-2 text-right">
                {key.revokedAt ? (
                  <span className="text-xs">Revoked {format.format(new Date(key.revokedAt))}</span>
                ) : canManage ? (
                  <RevokeKeyForm keyId={key.id} label={`${key.merchantName} / ${key.name}`} />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RevokeKeyForm({ keyId, label }: { keyId: string; label: string }) {
  const [state, action] = useActionState<ApiAdminState, FormData>(
    async (previous, formData) => adminRevokeApiKey(previous, formData),
    null,
  );
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Revoke "${label}"? Their integration stops immediately.`)) {
          event.preventDefault();
        }
      }}
      className="inline-flex flex-col items-end gap-1"
    >
      <input type="hidden" name="keyId" value={keyId} />
      <SubmitButton variant="ghost" size="sm" loadingLabel="Revoking…">
        Revoke
      </SubmitButton>
      {state && !state.ok && (
        <span role="alert" className="text-xs text-error">
          {ERRORS[state.error] ?? ERRORS['admin.errors.generic']}
        </span>
      )}
    </form>
  );
}

export function AdminWebhooksTable({
  webhooks,
  canManage,
}: {
  webhooks: AdminWebhookRow[];
  canManage: boolean;
}) {
  if (webhooks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
        No merchant has registered a webhook endpoint yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="bg-cream text-left text-xs text-ink-600 uppercase">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Merchant
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Endpoint
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Events
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Queue
            </th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {webhooks.map((hook) => (
            <tr
              key={hook.id}
              className={hook.status === 'disabled' ? 'text-ink-400' : 'text-ink-900'}
            >
              <td className="px-3 py-2">{hook.merchantName}</td>
              <td className="px-3 py-2">
                <div className="max-w-xs truncate font-mono text-xs" title={hook.url}>
                  {hook.url}
                </div>
                {hook.description && <div className="text-xs text-ink-600">{hook.description}</div>}
              </td>
              <td className="px-3 py-2 text-xs" title={hook.events.join(', ')}>
                {hook.events.length} event{hook.events.length === 1 ? '' : 's'}
              </td>
              <td className="px-3 py-2">
                <div className="capitalize">{hook.status}</div>
                {hook.disabledReason && (
                  <div className="text-xs text-ink-600">
                    {hook.disabledReason.replaceAll('_', ' ')}
                  </div>
                )}
                {hook.consecutiveFailures > 0 && (
                  <div className="text-xs text-warning">
                    {hook.consecutiveFailures} failure{hook.consecutiveFailures === 1 ? '' : 's'} in
                    a row
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-xs whitespace-nowrap">
                {hook.pending} pending · {hook.failed} failed
              </td>
              <td className="px-3 py-2 text-right">
                {canManage && (
                  <WebhookStatusForm
                    webhookId={hook.id}
                    next={hook.status === 'active' ? 'disabled' : 'active'}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WebhookStatusForm({
  webhookId,
  next,
}: {
  webhookId: string;
  next: 'active' | 'disabled';
}) {
  const [state, action] = useActionState<ApiAdminState, FormData>(
    async (previous, formData) => adminSetWebhookStatus(previous, formData),
    null,
  );
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="webhookId" value={webhookId} />
      <input type="hidden" name="status" value={next} />
      <SubmitButton variant="ghost" size="sm" loadingLabel="Saving…">
        {next === 'active' ? 'Enable' : 'Disable'}
      </SubmitButton>
      {state && !state.ok && (
        <span role="alert" className="text-xs text-error">
          {ERRORS[state.error] ?? ERRORS['admin.errors.generic']}
        </span>
      )}
    </form>
  );
}
