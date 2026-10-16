import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { uploadProposalImage } from '@/features/merchants/api/images';
import { apiError } from '@/features/merchants/api/respond';

/**
 * docs/18 §3.5 — `POST /proposals/{batchId}/rows/{proposalId}/images`: one photograph of the box.
 *
 * Raw image bytes with their content type, or `multipart/form-data` with a `file` field. One image
 * per request, 2 MB, JPEG / PNG / WebP / AVIF — the bucket's own limits. Up to six per row, the same
 * as the portal. The flow and the one place the service client appears are in `images.ts`.
 */
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ batchId: string; proposalId: string }> },
) {
  const { batchId, proposalId } = await context.params;
  if (!uuid.safeParse(batchId).success || !uuid.safeParse(proposalId).success) {
    return apiError('not_found', 404);
  }
  return uploadProposalImage(request, batchId, proposalId);
}
