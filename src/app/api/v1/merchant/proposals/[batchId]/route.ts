import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { runMerchantApi } from '@/features/merchants/api/handler';
import { apiError } from '@/features/merchants/api/respond';

/**
 * docs/18 §3.4 — `GET /proposals/{batchId}`: one batch with its rows.
 *
 * The row ids are what the photograph upload (§3.5) is keyed on, so this is the call between
 * "I posted a catalogue" and "here are the pictures". Each row carries its image count so a sync
 * can tell what it has already sent.
 */
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();

export async function GET(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await context.params;
  if (!uuid.safeParse(batchId).success) return apiError('not_found', 404);
  return runMerchantApi(request, { action: 'proposals.batch', params: { batch_id: batchId } });
}
