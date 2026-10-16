import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { Json } from '@/lib/supabase/database.types';
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  signWebhookPayload,
} from '@/features/merchants/webhooks/signature';

/**
 * docs/18 §3.6 — draining the delivery queue.
 *
 * `claim_webhook_deliveries` hands out the due rows under `skip locked` with the next attempt already
 * scheduled, so an overlapping run or a run that dies mid-way can only ever leave rows that come due
 * again. Each is POSTed with a signed body and a ten-second timeout; `record_webhook_delivery` writes
 * the outcome and applies the retry and auto-disable rules. Both functions are service-role only —
 * this is a cron job, one of the sanctioned uses in docs/02 §6.
 *
 * The body is the canonical event envelope, and the signature is over **the exact bytes sent**, so a
 * receiver verifies the raw body before parsing it. Re-serialising first would break the signature
 * for any JSON library that orders keys differently.
 */

export interface ClaimedDelivery {
  id: string;
  webhook_id: string;
  merchant_id: string;
  event: string;
  payload: Json;
  attempts: number;
  created_at: string;
  url: string;
  secret: string;
}

export interface DeliveryOutcome {
  id: string;
  ok: boolean;
  statusCode: number | null;
  error: string | null;
}

const TIMEOUT_MS = 10_000;

/** The wire format. Exported so the docs example and the unit test are the same shape. */
export function webhookBody(delivery: Omit<ClaimedDelivery, 'url' | 'secret'>): string {
  return JSON.stringify({
    id: delivery.id,
    event: delivery.event,
    created_at: delivery.created_at,
    attempt: delivery.attempts,
    merchant_id: delivery.merchant_id,
    data: delivery.payload,
  });
}

/** One POST. Never throws: the outcome is data for `record_webhook_delivery`. */
export async function deliverOne(
  delivery: ClaimedDelivery,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryOutcome> {
  const body = webhookBody(delivery);
  const timestamp = Math.floor(Date.now() / 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetchImpl(delivery.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'BioCode-Webhooks/1',
        [SIGNATURE_HEADER]: signWebhookPayload(delivery.secret, body, timestamp),
        [EVENT_HEADER]: delivery.event,
        [DELIVERY_HEADER]: delivery.id,
      },
      body,
      signal: controller.signal,
      redirect: 'manual',
    });

    const ok = response.status >= 200 && response.status < 300;
    return {
      id: delivery.id,
      ok,
      statusCode: response.status,
      error: ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: delivery.id,
      ok: false,
      statusCode: null,
      error: controller.signal.aborted ? `timeout after ${TIMEOUT_MS} ms` : message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Claims, delivers and records one batch. Returns counts for the cron summary.
 *
 * Deliveries run with bounded concurrency rather than one at a time: fifty endpoints at ten seconds
 * each, serially, is longer than a cron invocation gets. Eight at once keeps the worst case under the
 * route's `maxDuration` and is gentle on any single merchant's server.
 */
export async function drainWebhookQueue(
  batchSize = 50,
  fetchImpl: typeof fetch = fetch,
): Promise<{ claimed: number; delivered: number; failed: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('claim_webhook_deliveries', { p_limit: batchSize });
  if (error) {
    logger.error('claim_webhook_deliveries failed', { cause: error.message });
    return { claimed: 0, delivered: 0, failed: 0 };
  }

  const claimed = (data ?? []) as unknown as ClaimedDelivery[];
  let delivered = 0;
  let failed = 0;

  const queue = [...claimed];
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const outcome = await deliverOne(next, fetchImpl);
      const { error: recordError } = await admin.rpc('record_webhook_delivery', {
        p_delivery_id: outcome.id,
        p_ok: outcome.ok,
        p_status_code: outcome.statusCode ?? undefined,
        p_error: outcome.error ?? undefined,
      });
      if (recordError) {
        logger.error('record_webhook_delivery failed', {
          id: outcome.id,
          cause: recordError.message,
        });
      }
      if (outcome.ok) delivered += 1;
      else failed += 1;
    }
  });
  await Promise.all(workers);

  return { claimed: claimed.length, delivered, failed };
}
