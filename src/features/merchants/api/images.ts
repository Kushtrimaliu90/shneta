import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { execMerchantApi } from '@/features/merchants/api/exec';
import { authenticate, respondTo } from '@/features/merchants/api/handler';
import { apiError } from '@/features/merchants/api/respond';
import { imageExtensionFor } from '@/features/merchants/api/image-types';

/**
 * docs/18 §3.5 — a photograph for a proposal row, over the API.
 *
 * ── Why this is the one route that touches the service client ──
 *
 * The portal uploads from the browser under the merchant's own session, and the storage policy on
 * `merchant-proposals` checks `current_merchant_ids()` against the folder. An API call has no session
 * for storage to check — the identity lives inside one SQL transaction, and a storage upload is a
 * separate HTTP request. So the bytes are written with the service-role storage client, and what
 * keeps that safe is the order of operations:
 *
 *   1. `proposals.image_slot` runs **as the merchant** and decides whether this row may take a
 *      photograph at all — the batch is theirs and still pending, the row is in it and still open,
 *      fewer than six images — and mints the exact object path, under the merchant's own prefix with
 *      a server-chosen name. Nothing in the path came from the caller.
 *   2. The bytes go to that path and nowhere else.
 *   3. `proposals.attach_image` runs as the merchant again through `merchant_attach_batch_images`,
 *      which re-checks the prefix, the batch and the row and refuses anything else.
 *
 * The service client therefore never acts on a caller-supplied path, and never writes a row. It is
 * recorded in docs/02 §6 beside `proposal-promote.ts`, which moves the same bytes the other way.
 *
 * ── Limits ──
 *
 * The same as the bucket and the portal: 2 MB, four formats. The body is read whole because the
 * bucket's own limit would refuse it anyway and a streaming check saves nothing for a 2 MB cap.
 */

const MAX_BYTES = 2 * 1024 * 1024;

export async function uploadProposalImage(
  request: NextRequest,
  batchId: string,
  proposalId: string,
): Promise<NextResponse> {
  const caller = await authenticate(request);
  if (caller instanceof NextResponse) return caller;

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) return apiError('too_large', 413);

  /*
   * Raw bytes with an image content type, or `multipart/form-data` with a `file` field — whichever
   * the merchant's HTTP library finds easier. The content type that matters is the image's own.
   */
  let bytes: ArrayBuffer;
  let contentType: string | null;
  const requestType = request.headers.get('content-type') ?? '';

  if (requestType.toLowerCase().startsWith('multipart/form-data')) {
    let file: File | null = null;
    try {
      const form = await request.formData();
      const value = form.get('file');
      if (value instanceof File) file = value;
    } catch {
      return apiError('invalid_body', 400, [{ path: ['file'], message: 'Unreadable form body.' }]);
    }
    if (!file) {
      return apiError('invalid_body', 400, [
        { path: ['file'], message: 'A `file` field is required.' },
      ]);
    }
    if (file.size > MAX_BYTES) return apiError('too_large', 413);
    bytes = await file.arrayBuffer();
    contentType = file.type || null;
  } else {
    bytes = await request.arrayBuffer();
    contentType = requestType || null;
  }

  if (bytes.byteLength === 0) {
    return apiError('invalid_body', 400, [{ path: [], message: 'The image is empty.' }]);
  }
  if (bytes.byteLength > MAX_BYTES) return apiError('too_large', 413);

  const ext = imageExtensionFor(contentType);
  if (!ext) return apiError('unsupported_media_type', 415);

  // 1 · May this row take a photograph, and where does it go?
  const slot = await execMerchantApi(caller.token, 'proposals.image_slot', {
    batch_id: batchId,
    proposal_id: proposalId,
    ext,
  });
  if (slot.kind !== 'ok') return respondTo(request, caller, 'proposals.image_slot', slot);

  const path = (slot.data as { path?: string } | null)?.path;
  if (!path || !path.startsWith('proposals/')) {
    logger.error('image slot returned no path', { key: caller.prefix });
    return apiError('internal', 500);
  }

  // 2 · The bytes, to that path and nowhere else.
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from('merchant-proposals')
    .upload(path, bytes, { contentType: contentType ?? undefined, upsert: false });

  if (uploadError) {
    logger.error('proposal image upload failed', {
      key: caller.prefix,
      cause: uploadError.message,
    });
    return apiError('internal', 500);
  }

  // 3 · The row, as the merchant, through the function that re-checks everything.
  const attached = await execMerchantApi(caller.token, 'proposals.attach_image', {
    batch_id: batchId,
    proposal_id: proposalId,
    path,
  });

  const count =
    attached.kind === 'ok' ? ((attached.data as { attached?: number })?.attached ?? 0) : 0;
  if (count === 0) {
    /*
     * The slot said yes a moment ago and the attach said no — a sixth image raced in, or the batch was
     * decided in between. The object would otherwise sit in the private bucket belonging to nothing.
     */
    await admin.storage.from('merchant-proposals').remove([path]);
    if (attached.kind !== 'ok')
      return respondTo(request, caller, 'proposals.attach_image', attached);
    return apiError('too_many_images', 409);
  }

  logger.info('merchant api call', { action: 'proposals.attach_image', key: caller.prefix });
  return respondTo(request, caller, 'proposals.attach_image', {
    kind: 'ok',
    data: { attached: count, path, proposal_id: proposalId },
  });
}
