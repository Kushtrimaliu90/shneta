'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { getMyMerchant } from '@/features/merchants/queries';
import { apiKeyPrefix, generateApiKey, hashApiKey } from '@/features/merchants/api-keys';
import { scopesSchema } from '@/features/merchants/api/schemas';

/**
 * docs/18 §5 — a merchant minting and revoking its own API keys.
 *
 * ── Shown once ──
 *
 * `createApiKey` returns the token in its result and nowhere else. The row holds the hash, the
 * portal lists the prefix, and a merchant who loses the token revokes it and makes another. There
 * is no "show key" — that would require storing it, and a stored credential is a credential in
 * every backup.
 *
 * ── Thin on purpose ──
 *
 * The actions validate, name the merchant and insert through the SSR client on the merchant's own
 * session. The cap of five, the approved-only rule and the frozen columns are all enforced by
 * `guard_merchant_api_key_write` in the database, so a second caller — an admin tool, a script —
 * meets the same wall. Same shape as every other portal action (docs/16 §5).
 */

export type ApiKeyErrorKey =
  | 'merchant.api.errors.generic'
  | 'merchant.api.errors.invalid'
  | 'merchant.api.errors.notMerchant'
  | 'merchant.api.errors.notApproved'
  | 'merchant.api.errors.tooMany'
  | 'merchant.api.errors.notFound';

export interface CreatedApiKey {
  /** The full token. This is the only time it exists outside the merchant's own hands. */
  token: string;
  prefix: string;
  name: string;
  scopes: string[];
}

export type CreateApiKeyState = ActionResult<CreatedApiKey, ApiKeyErrorKey> | null;
export type RevokeApiKeyState = ActionResult<{ id: string }, ApiKeyErrorKey> | null;

const createSchema = z.object({
  name: z.string().trim().min(2, 'required').max(60),
  /**
   * Fixed at creation (docs/18 §2.1): a key's scopes are what it could ever do, so the portal's list
   * is an honest audit trail. Wanting different scopes means a new key, which is also the moment to
   * retire the old one.
   */
  scopes: scopesSchema,
});

const revokeSchema = z.object({
  keyId: z.string().uuid(),
});

export async function createApiKey(
  _previous: CreateApiKeyState,
  formData: FormData,
): Promise<CreateApiKeyState> {
  const merchant = await getMyMerchant();
  if (!merchant) return fail('merchant.api.errors.notMerchant');
  if (merchant.status !== 'approved') return fail('merchant.api.errors.notApproved');

  // `getAll`, because a checkbox group shares one name and `Object.fromEntries` keeps only the last.
  const parsed = createSchema.safeParse({
    name: formData.get('name'),
    scopes: formData.getAll('scopes'),
  });
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return fail('merchant.api.errors.invalid', {
      ...(flat.name ? { name: ['required'] } : {}),
      ...(flat.scopes ? { scopes: ['required'] } : {}),
    });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail('merchant.api.errors.notMerchant');

    const token = generateApiKey();

    const { error } = await supabase.from('merchant_api_keys').insert({
      merchant_id: merchant.id,
      name: parsed.data.name,
      key_prefix: apiKeyPrefix(token),
      key_hash: hashApiKey(token),
      scopes: parsed.data.scopes,
      created_by: user.id,
    });

    if (error) {
      if (error.message.includes('API_KEY_LIMIT')) return fail('merchant.api.errors.tooMany');
      if (error.message.includes('MERCHANT_NOT_APPROVED')) {
        return fail('merchant.api.errors.notApproved');
      }
      logger.error('createApiKey failed', { cause: error.message });
      return fail('merchant.api.errors.generic');
    }

    revalidatePath('/merchant/api');
    return ok({
      token,
      prefix: apiKeyPrefix(token),
      name: parsed.data.name,
      scopes: parsed.data.scopes,
    });
  } catch (error) {
    logger.error('createApiKey threw', describeError(error));
    return fail('merchant.api.errors.generic');
  }
}

export async function revokeApiKey(
  _previous: RevokeApiKeyState,
  formData: FormData,
): Promise<RevokeApiKeyState> {
  const merchant = await getMyMerchant();
  if (!merchant) return fail('merchant.api.errors.notMerchant');

  const parsed = revokeSchema.safeParse({ keyId: formData.get('keyId') });
  if (!parsed.success) return fail('merchant.api.errors.invalid');

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail('merchant.api.errors.notMerchant');

    /*
     * `.select()` on the update, so a row RLS hid — or one already revoked — reads as "not found"
     * rather than as success. PostgREST reports zero matched rows as a clean update (docs/13 §X15).
     */
    const { data, error } = await supabase
      .from('merchant_api_keys')
      .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
      .eq('id', parsed.data.keyId)
      .eq('merchant_id', merchant.id)
      .is('revoked_at', null)
      .select('id');

    if (error) {
      logger.error('revokeApiKey failed', { cause: error.message });
      return fail('merchant.api.errors.generic');
    }
    if (!data || data.length === 0) return fail('merchant.api.errors.notFound');

    revalidatePath('/merchant/api');
    return ok({ id: parsed.data.keyId });
  } catch (error) {
    logger.error('revokeApiKey threw', describeError(error));
    return fail('merchant.api.errors.generic');
  }
}
