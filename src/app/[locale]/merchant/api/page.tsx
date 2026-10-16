import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { clientEnv } from '@/lib/env.client';
import { getMyMerchant } from '@/features/merchants/queries';
import { listMyApiKeys } from '@/features/merchants/api-key-queries';
import { ApiKeysPanel } from '@/features/merchants/components/api-keys-panel';

export const metadata: Metadata = { title: 'API' };
export const dynamic = 'force-dynamic';

/**
 * docs/18 §5 — keys, and the short version of the reference beside them.
 *
 * Approved merchants only, like every page that touches supply: a key for a pending merchant would
 * be refused by the database anyway (`guard_merchant_api_key_write`), and a page that offers a button
 * that cannot work is worse than a locked nav entry.
 *
 * The endpoint table is here rather than only in docs/18 because the person configuring an ERP is
 * usually the merchant's own developer on the merchant's own account, and the portal is where they
 * are when they have a key in hand. The full reference is one link away.
 */
export default async function MerchantApiPage() {
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') notFound();

  const t = await getTranslations('merchant.api');
  const keys = await listMyApiKeys();
  const base = `${clientEnv.NEXT_PUBLIC_SITE_URL}/api/v1/merchant`;

  const endpoints = [
    { method: 'GET', path: '/me', key: 'me' },
    { method: 'GET', path: '/catalogue', key: 'catalogue' },
    { method: 'GET', path: '/offers', key: 'offersGet' },
    { method: 'POST', path: '/offers', key: 'offersPost' },
    { method: 'GET', path: '/proposals', key: 'proposalsGet' },
    { method: 'POST', path: '/proposals', key: 'proposalsPost' },
    { method: 'GET', path: '/proposals/{batchId}', key: 'proposalsBatch' },
    { method: 'POST', path: '/proposals/{batchId}/rows/{rowId}/images', key: 'proposalsImages' },
    { method: 'GET', path: '/fulfilments', key: 'fulfilmentsGet' },
    { method: 'GET', path: '/fulfilments/{id}', key: 'fulfilmentGet' },
    { method: 'POST', path: '/fulfilments/{id}/{accept|pack|ship|decline}', key: 'fulfilmentPost' },
    { method: 'GET', path: '/webhooks', key: 'webhooksGet' },
    { method: 'POST', path: '/webhooks', key: 'webhooksPost' },
  ] as const;

  const example = [
    `curl -X POST ${base}/offers \\`,
    `  -H "Authorization: Bearer bck_live_…" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"rows":[{"sku":"BC-0042","stock":120,"price_cents":990}]}'`,
  ].join('\n');

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h2 className="font-display text-xl font-semibold text-forest-900">{t('title')}</h2>
        <p className="mt-1 text-sm text-ink-600">{t('intro')}</p>
      </header>

      <ApiKeysPanel keys={keys} />

      <section aria-labelledby="api-docs" className="flex flex-col gap-3">
        <h3 id="api-docs" className="font-display text-lg font-semibold text-forest-900">
          {t('docsTitle')}
        </h3>
        <p className="text-sm text-ink-600">{t('docsIntro')}</p>

        <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-line bg-cream p-4 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-ink-600">{t('baseUrl')}</dt>
          <dd className="font-mono text-xs break-all text-ink-900">{base}</dd>
          <dt className="text-ink-600">{t('authHeader')}</dt>
          <dd className="font-mono text-xs text-ink-900">Authorization: Bearer bck_live_…</dd>
        </dl>

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-cream text-left text-xs text-ink-600 uppercase">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('columns.endpoint')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('columns.does')}
                </th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((endpoint) => (
                <tr key={`${endpoint.method} ${endpoint.path}`} className="text-ink-900">
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {endpoint.method} {endpoint.path}
                  </td>
                  <td className="px-3 py-2">{t(`endpoints.${endpoint.key}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="mt-2 text-sm font-medium text-ink-900">{t('exampleTitle')}</h4>
        <pre className="overflow-x-auto rounded-lg border border-line bg-forest-900 p-4 font-mono text-xs leading-relaxed text-cream">
          <code>{example}</code>
        </pre>
        <p className="text-xs text-ink-600">{t('notes')}</p>
      </section>
    </div>
  );
}
