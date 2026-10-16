'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { ActionForm } from '@/components/ui/action-form';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  createApiKey,
  revokeApiKey,
  type CreateApiKeyState,
  type RevokeApiKeyState,
} from '@/features/merchants/api-key-actions';
import type { ApiKeyRow } from '@/features/merchants/api-key-queries';
import { API_SCOPES, type ApiScope } from '@/features/merchants/api/scopes';
import { apiErrorLeaf } from '@/features/merchants/error-keys';

/** The cap `guard_merchant_api_key_write` enforces; repeated here only to say so on the screen. */
const MAX_ACTIVE_KEYS = 5;

/** What a key gets when the merchant does not think about it: everything but order handling. */
const DEFAULT_SCOPES: readonly ApiScope[] = [
  'catalogue:read',
  'offers:read',
  'offers:write',
  'proposals:read',
  'proposals:write',
  'webhooks:read',
  'webhooks:write',
];

/**
 * docs/18 §5 — the merchant's keys: make one, see the list, revoke one.
 *
 * ── The token is shown once, here ──
 *
 * The success branch of `createApiKey` is the only place the full token ever renders. It stays on
 * screen until the merchant navigates away; the list below it shows the prefix and nothing more. A
 * merchant who did not copy it revokes and starts again — there is no path that shows it twice.
 *
 * ── Scopes are chosen at creation and never change ──
 *
 * Nine checkboxes, grouped so the shape reads: the stock sync gets offers, the warehouse tool gets
 * orders. Order handling is off by default because it is the one scope that reaches a customer's
 * address — a merchant should tick it on purpose.
 *
 * Revocation is a confirm, not a modal: it is one click to undo a leak, and a merchant doing that
 * in a hurry should not be fighting a dialog. A revoked key is listed, greyed, so "which one did I
 * just kill?" has an answer.
 */
export function ApiKeysPanel({ keys }: { keys: ApiKeyRow[] }) {
  const t = useTranslations('merchant.api');
  const locale = useLocale();
  const [state, action] = useActionState<CreateApiKeyState, FormData>(
    async (previous, formData) => createApiKey(previous, formData),
    null,
  );

  const active = keys.filter((key) => key.revokedAt === null).length;
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="flex flex-col gap-6">
      {state?.ok && (
        <RevealedKey token={state.data.token} name={state.data.name} scopes={state.data.scopes} />
      )}

      <section aria-labelledby="create-key" className="flex flex-col gap-4">
        <h3 id="create-key" className="font-display text-lg font-semibold text-forest-900">
          {t('createTitle')}
        </h3>
        <p className="text-sm text-ink-600">{t('createIntro')}</p>

        <ActionForm action={action} state={state} className="flex flex-col gap-4 sm:max-w-xl">
          {state && !state.ok && (
            <Alert tone="error" title={t(`errors.${apiErrorLeaf(state.error)}`)} />
          )}

          <Field id="name" label={t('nameLabel')} hint={t('nameHint')} required>
            {(field) => (
              <Input {...field} name="name" maxLength={60} autoComplete="off" placeholder="ERP" />
            )}
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink-900">{t('scopesLabel')}</legend>
            <p className="text-xs text-ink-600">{t('scopesHint')}</p>
            {state && !state.ok && state.fieldErrors?.scopes && (
              <p role="alert" className="text-xs text-error">
                {t('errors.scopesRequired')}
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-3">
              {API_SCOPES.map((scope) => (
                <label key={scope} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="scopes"
                    value={scope}
                    defaultChecked={DEFAULT_SCOPES.includes(scope)}
                    className="mt-0.5 size-4 shrink-0 accent-forest-700"
                  />
                  <span className="flex flex-col">
                    <span className="font-mono text-xs text-ink-900">{scope}</span>
                    <span className="text-xs text-ink-600">
                      {t(`scopes.${SCOPE_MESSAGE[scope]}`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton disabled={active >= MAX_ACTIVE_KEYS} loadingLabel={t('creating')}>
              {t('create')}
            </SubmitButton>
            <span className="text-xs text-ink-600">
              {t('limit', { count: active, max: MAX_ACTIVE_KEYS })}
            </span>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="keys" className="flex flex-col gap-3">
        <h3 id="keys" className="font-display text-lg font-semibold text-forest-900">
          {t('keysTitle')}
        </h3>

        {keys.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
            {t('noKeys')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-cream text-left text-xs text-ink-600 uppercase">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('columns.name')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('columns.prefix')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('columns.scopes')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('columns.created')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('columns.lastUsed')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('columns.status')}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">{t('columns.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => {
                  const revoked = key.revokedAt !== null;
                  return (
                    <tr
                      key={key.id}
                      className={revoked ? 'text-ink-400' : 'text-ink-900'}
                      data-testid="api-key-row"
                    >
                      <td className="px-3 py-2">{key.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{key.prefix}…</td>
                      <td className="px-3 py-2">
                        <ScopeBadges scopes={key.scopes} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {format.format(new Date(key.createdAt))}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {key.lastUsedAt ? format.format(new Date(key.lastUsedAt)) : t('never')}
                      </td>
                      <td className="px-3 py-2">{revoked ? t('revoked') : t('active')}</td>
                      <td className="px-3 py-2 text-right">
                        {!revoked && <RevokeForm keyId={key.id} name={key.name} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** The message leaf under `merchant.api.scopes` for each scope, typed so a missing message fails the build. */
const SCOPE_MESSAGE: Record<
  ApiScope,
  | 'catalogueRead'
  | 'offersRead'
  | 'offersWrite'
  | 'proposalsRead'
  | 'proposalsWrite'
  | 'ordersRead'
  | 'ordersWrite'
  | 'webhooksRead'
  | 'webhooksWrite'
> = {
  'catalogue:read': 'catalogueRead',
  'offers:read': 'offersRead',
  'offers:write': 'offersWrite',
  'proposals:read': 'proposalsRead',
  'proposals:write': 'proposalsWrite',
  'orders:read': 'ordersRead',
  'orders:write': 'ordersWrite',
  'webhooks:read': 'webhooksRead',
  'webhooks:write': 'webhooksWrite',
};

export function ScopeBadges({ scopes }: { scopes: string[] }) {
  const all = scopes.length === API_SCOPES.length;
  const t = useTranslations('merchant.api');
  if (all) return <span className="text-xs text-ink-600">{t('allScopes')}</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {scopes.map((scope) => (
        <li
          key={scope}
          className="rounded-sm border border-line bg-cream px-1.5 py-0.5 font-mono text-[11px]"
        >
          {scope}
        </li>
      ))}
    </ul>
  );
}

function RevealedKey({ token, name, scopes }: { token: string; name: string; scopes: string[] }) {
  const t = useTranslations('merchant.api');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      // A browser without clipboard access: the token is on screen, selectable, and that is enough.
    }
  }

  return (
    <Alert tone="success" title={t('createdTitle', { name })}>
      <p className="text-sm">{t('createdIntro')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code
          className="rounded-md border border-line bg-cream px-2 py-1.5 font-mono text-xs break-all select-all"
          data-testid="api-key-token"
        >
          {token}
        </code>
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
      <div className="mt-2">
        <ScopeBadges scopes={scopes} />
      </div>
    </Alert>
  );
}

function RevokeForm({ keyId, name }: { keyId: string; name: string }) {
  const t = useTranslations('merchant.api');
  const [state, action] = useActionState<RevokeApiKeyState, FormData>(
    async (previous, formData) => revokeApiKey(previous, formData),
    null,
  );

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(t('revokeConfirm', { name }))) event.preventDefault();
      }}
      className="inline-flex flex-col items-end gap-1"
    >
      <input type="hidden" name="keyId" value={keyId} />
      <SubmitButton variant="ghost" size="sm" loadingLabel={t('revoking')}>
        {t('revoke')}
      </SubmitButton>
      {state && !state.ok && (
        <span role="alert" className="text-xs text-error">
          {t(`errors.${apiErrorLeaf(state.error)}`)}
        </span>
      )}
    </form>
  );
}
