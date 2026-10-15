import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { cn } from '@/lib/utils';
import {
  listAllApiKeys,
  listAllWebhooks,
  type AdminKeyFilter,
} from '@/features/merchants/api-admin-queries';
import {
  AdminApiKeysTable,
  AdminWebhooksTable,
} from '@/features/merchants/components/api-admin-panel';

export const metadata: Metadata = { title: 'Merchant API' };
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * docs/18 §5 — every merchant's API keys and webhook endpoints, in one place.
 *
 * `merchants.view` opens the screen; `merchants.manage` is what the revoke and disable buttons check.
 * Nothing here can read a key or a secret — those exist only as a hash and, for webhooks, in a column
 * no admin query selects. What an admin can do is stop something: a key that is being abused, an
 * endpoint that is misbehaving, with an audit row for each.
 */
export default async function AdminMerchantApiPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!can(profile?.role, 'merchants.view')) redirect('/admin');
  const canManage = can(profile?.role, 'merchants.manage');

  const params = await searchParams;
  const raw = Array.isArray(params.keys) ? params.keys[0] : params.keys;
  const filter: AdminKeyFilter = raw === 'revoked' ? 'revoked' : 'active';

  const [keys, webhooks] = await Promise.all([listAllApiKeys(filter), listAllWebhooks()]);

  return (
    <section className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-2xl font-semibold text-forest-900">Merchant API</h1>
        <p className="mt-1 text-sm text-ink-600">
          Keys merchants use against <code className="font-mono text-xs">/api/v1/merchant</code> and
          the webhook endpoints they registered. Revoking a key stops their integration immediately;
          disabling an endpoint pauses deliveries without losing its configuration.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-forest-900">API keys</h2>
          <nav aria-label="Filter keys" className="flex gap-1.5">
            {(['active', 'revoked'] as const).map((entry) => (
              <Link
                key={entry}
                href={`/admin/merchants/api?keys=${entry}`}
                aria-current={entry === filter ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-8 items-center rounded-sm border px-2.5 text-xs capitalize transition-colors',
                  entry === filter
                    ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
                    : 'border-line-strong text-ink-600 hover:bg-forest-50',
                )}
              >
                {entry}
              </Link>
            ))}
          </nav>
        </div>
        <AdminApiKeysTable keys={keys} canManage={canManage} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-forest-900">Webhook endpoints</h2>
        <p className="text-sm text-ink-600">
          Delivered every five minutes by the webhook cron with backoff. An endpoint that fails
          twenty-five attempts in a row is disabled automatically and listed here with the reason.
        </p>
        <AdminWebhooksTable webhooks={webhooks} canManage={canManage} />
      </div>
    </section>
  );
}
