import 'server-only';
import { createPublicClient } from '@/lib/supabase/public';
import { logger, describeError } from '@/lib/logger';
import type { Json } from '@/lib/supabase/database.types';
import type { ApiErrorCode } from '@/features/merchants/api/respond';
import type { MerchantApiAction } from '@/features/merchants/api/scopes';

export type { MerchantApiAction };

/**
 * docs/18 §1 — the one call every endpoint makes.
 *
 * `merchant_api_exec` verifies the key and its scope, becomes the merchant for the transaction and
 * runs the named action. This wrapper exists so the routes never see a Supabase client: they hand
 * over a token, an action and a payload, and get back one of three things — data, "not you", or a
 * named failure.
 *
 * ── The anon client, deliberately ──
 *
 * There is no session to carry. The credential is the API key *inside the argument*, and the SQL
 * decides what it is worth; the JWT on the wire is the anon key and grants nothing on its own. This
 * is the opposite of the service client — a route that reached for `createAdminClient()` here would
 * be putting the one key that bypasses every trigger into the merchant lane (docs/16 §5).
 */

export type ExecResult =
  | { kind: 'ok'; data: Json }
  | { kind: 'unauthorized' }
  | { kind: 'error'; code: Exclude<ApiErrorCode, 'unauthorized'>; status: number; details?: Json };

/**
 * Exceptions the underlying functions raise, and what each means to a caller. Order matters where
 * one needle is a substring of another, so the longer ones come first.
 *
 * `FORBIDDEN` should be unreachable — the entry point names the merchant that the inner function then
 * checks — so it is mapped to `unauthorized` rather than `internal`: if it ever fires, the honest
 * reading is that the key did not establish the identity it was supposed to.
 */
const RAISED: ReadonlyArray<[needle: string, result: ExecResult]> = [
  ['TOO_MANY_OPEN_BATCHES', { kind: 'error', code: 'too_many_open_batches', status: 422 }],
  ['TOO_MANY_WEBHOOKS', { kind: 'error', code: 'too_many_webhooks', status: 422 }],
  ['TOO_MANY_IMAGES', { kind: 'error', code: 'too_many_images', status: 409 }],
  ['TOO_MANY_ROWS', { kind: 'error', code: 'too_many_rows', status: 422 }],
  ['NO_ROWS', { kind: 'error', code: 'empty', status: 422 }],
  ['ROWS_NOT_AN_ARRAY', { kind: 'error', code: 'invalid_body', status: 400 }],
  ['BAD_IMAGE_TYPE', { kind: 'error', code: 'unsupported_media_type', status: 415 }],
  ['BATCH_ALREADY_DECIDED', { kind: 'error', code: 'batch_decided', status: 409 }],
  ['BATCH_NOT_FOUND', { kind: 'error', code: 'not_found', status: 404 }],
  ['FULFILMENT_TRANSITION_FORBIDDEN', { kind: 'error', code: 'wrong_state', status: 409 }],
  ['FULFILMENT_FIELD_FORBIDDEN', { kind: 'error', code: 'invalid_body', status: 400 }],
  ['WEBHOOK_FIELD_FORBIDDEN', { kind: 'error', code: 'invalid_body', status: 400 }],
  // A CHECK constraint on the webhook row: an https URL, a known event, a well-formed secret.
  ['merchant_webhooks_', { kind: 'error', code: 'invalid_body', status: 400 }],
  ['FORBIDDEN', { kind: 'unauthorized' }],
];

export async function execMerchantApi(
  token: string,
  action: MerchantApiAction,
  payload: Json = {},
): Promise<ExecResult> {
  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc('merchant_api_exec', {
      p_key: token,
      p_action: action,
      p_payload: payload,
    });

    if (error) {
      const known = RAISED.find(([needle]) => error.message.includes(needle));
      if (known) return known[1];
      logger.error('merchant api exec failed', { action, cause: error.message });
      return { kind: 'error', code: 'internal', status: 500 };
    }

    const envelope = (data ?? null) as {
      ok?: boolean;
      error?: string;
      scope?: string;
      data?: Json;
    } | null;
    if (!envelope || typeof envelope.ok !== 'boolean') {
      logger.error('merchant api exec returned no envelope', { action });
      return { kind: 'error', code: 'internal', status: 500 };
    }

    if (!envelope.ok) {
      switch (envelope.error) {
        case 'unauthorized':
          return { kind: 'unauthorized' };
        case 'insufficient_scope':
          return {
            kind: 'error',
            code: 'insufficient_scope',
            status: 403,
            details: { required_scope: envelope.scope ?? null },
          };
        case 'not_found':
          return { kind: 'error', code: 'not_found', status: 404 };
        default:
          // `unknown_action` can only be a programming error here: the routes name the actions.
          logger.error('merchant api exec refused', { action, cause: envelope.error ?? 'unknown' });
          return { kind: 'error', code: 'internal', status: 500 };
      }
    }

    return { kind: 'ok', data: envelope.data ?? null };
  } catch (error) {
    logger.error('merchant api exec threw', { action, ...describeError(error) });
    return { kind: 'error', code: 'internal', status: 500 };
  }
}
