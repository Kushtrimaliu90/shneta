'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';

/**
 * docs/18 §5 — what an admin may do to a merchant's API from `/admin/merchants/api`.
 *
 * Two things, both reversible only by the merchant making something new: revoke a key, and switch a
 * webhook endpoint off or back on. Both go through the SSR client on the admin's own session, so
 * `p_admin_write` is what admits the write and `log_audit` stamps who did it. Neither touches a hash
 * or a secret — an admin cannot read a merchant's key or sign as BioCode to a merchant's endpoint.
 *
 * `merchants.manage` rather than `merchants.view`: revoking a key stops a merchant's integration
 * mid-sync, which is a commercial act with a phone call attached, not a support action.
 */

export type ApiAdminErrorKey = 'admin.errors.forbidden' | 'admin.errors.generic';

export type ApiAdminState = ActionResult<{ id: string }, ApiAdminErrorKey> | null;

const revokeSchema = z.object({ keyId: z.string().uuid() });
const webhookSchema = z.object({
  webhookId: z.string().uuid(),
  status: z.enum(['active', 'disabled']),
});

export async function adminRevokeApiKey(
  _previous: ApiAdminState,
  formData: FormData,
): Promise<ApiAdminState> {
  const gate = await requireCapability('merchants.manage');
  if (!gate.ok) return fail(gate.error);

  const parsed = revokeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail('admin.errors.generic');

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('merchant_api_keys')
      .update({ revoked_at: new Date().toISOString(), revoked_by: gate.actor.id })
      .eq('id', parsed.data.keyId)
      .is('revoked_at', null)
      .select('id, merchant_id, name, key_prefix');

    if (error) {
      logger.error('adminRevokeApiKey failed', { cause: error.message });
      return fail('admin.errors.generic');
    }
    const row = data?.[0];
    if (!row) return fail('admin.errors.generic');

    await audit('merchant.api_key_revoked', 'merchant_api_key', row.id, null, {
      merchant_id: row.merchant_id,
      name: row.name,
      key_prefix: row.key_prefix,
    });

    revalidatePath('/admin/merchants/api');
    return ok({ id: row.id });
  } catch (error) {
    logger.error('adminRevokeApiKey threw', describeError(error));
    return fail('admin.errors.generic');
  }
}

export async function adminSetWebhookStatus(
  _previous: ApiAdminState,
  formData: FormData,
): Promise<ApiAdminState> {
  const gate = await requireCapability('merchants.manage');
  if (!gate.ok) return fail(gate.error);

  const parsed = webhookSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail('admin.errors.generic');
  const { webhookId, status } = parsed.data;

  try {
    const supabase = await createClient();
    /*
     * The admin is exempt from `guard_merchant_webhook_write`, so the housekeeping it would do for a
     * merchant — clearing the disable reason on re-enable — is done here explicitly, together with
     * the failure counter, so a re-enabled endpoint starts its twenty-five fresh.
     */
    const patch =
      status === 'active'
        ? { status, disabled_at: null, disabled_reason: null, consecutive_failures: 0 }
        : { status, disabled_at: new Date().toISOString(), disabled_reason: 'disabled_by_admin' };

    const { data, error } = await supabase
      .from('merchant_webhooks')
      .update(patch)
      .eq('id', webhookId)
      .select('id, merchant_id, url, status');

    if (error) {
      logger.error('adminSetWebhookStatus failed', { cause: error.message });
      return fail('admin.errors.generic');
    }
    const row = data?.[0];
    if (!row) return fail('admin.errors.generic');

    await audit(
      status === 'active' ? 'merchant.webhook_enabled' : 'merchant.webhook_disabled',
      'merchant_webhook',
      row.id,
      null,
      { merchant_id: row.merchant_id, url: row.url },
    );

    revalidatePath('/admin/merchants/api');
    return ok({ id: row.id });
  } catch (error) {
    logger.error('adminSetWebhookStatus threw', describeError(error));
    return fail('admin.errors.generic');
  }
}
