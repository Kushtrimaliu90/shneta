'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { getMyMerchant } from '@/features/merchants/queries';

/**
 * docs/16 §4 — recording a KYB document the merchant has just uploaded.
 *
 * ── Why the upload itself is not here ──
 *
 * The file goes to Storage from the **browser**, on the merchant's own session, and this action only
 * writes the row that points at it. Two reasons, and the first is decisive:
 *
 * 1. A server action's request body is capped (1 MB by default in Next 15). A scanned registration
 *    certificate is routinely 3–5 MB, so posting the file through an action would reject exactly the
 *    documents this screen exists to collect — and raising the limit means every action on the site
 *    accepts multi-megabyte bodies to serve one form.
 * 2. The storage policy is written against `current_merchant_ids()`, so a browser upload is already
 *    scoped to the merchant's own folder. Routing the bytes through the server would add a hop
 *    without adding a check.
 *
 * The path is therefore **verified rather than trusted**: the client says where it put the file, and
 * this action refuses any path that is not inside this merchant's own folder. Without that check a
 * merchant could record a row pointing at somebody else's document — the storage policy would still
 * refuse to *serve* it, but the admin queue would show a document that is not theirs.
 */

export type DocumentErrorKey =
  | 'merchant.documents.errors.generic'
  | 'merchant.documents.errors.invalid'
  | 'merchant.documents.errors.notMerchant';

export type DocumentState = ActionResult<{ documentId?: string }, DocumentErrorKey> | null;

const KINDS = [
  'business_registration',
  'vat_certificate',
  'id_document',
  'import_licence',
  'other',
] as const;

export async function recordMerchantDocument(
  _previous: DocumentState,
  formData: FormData,
): Promise<DocumentState> {
  const merchant = await getMyMerchant();
  if (!merchant) {
    return fail<DocumentErrorKey, { documentId?: string }>('merchant.documents.errors.notMerchant');
  }

  const kind = String(formData.get('kind') ?? '');
  const storagePath = String(formData.get('storagePath') ?? '');

  const invalid = fail<DocumentErrorKey, { documentId?: string }>(
    'merchant.documents.errors.invalid',
  );

  if (!(KINDS as readonly string[]).includes(kind)) return invalid;

  /*
   * The path must be inside this merchant's folder, and the comparison is exact rather than a
   * `startsWith` on the id alone: `merchants/<id>` is a prefix of `merchants/<id-of-another>` only if
   * ids can share a prefix, which uuids cannot — but writing the separator makes that independent of
   * the id format rather than a fact about uuids.
   */
  const expectedPrefix = `merchants/${merchant.id}/`;
  if (!storagePath.startsWith(expectedPrefix) || storagePath.length <= expectedPrefix.length) {
    logger.info('merchant document path rejected', { merchantId: merchant.id });
    return invalid;
  }
  // No traversal, and nothing nested deeper than the merchant's own folder.
  if (storagePath.includes('..') || storagePath.slice(expectedPrefix.length).includes('/')) {
    return invalid;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('merchant_documents')
      .insert({ merchant_id: merchant.id, kind, storage_path: storagePath })
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error('recordMerchantDocument failed', { cause: error.message });
      return fail<DocumentErrorKey, { documentId?: string }>('merchant.documents.errors.generic');
    }
    if (!data) return invalid;

    revalidatePath('/merchant/documents');
    revalidatePath('/admin/merchants/applications');
    return ok({ documentId: (data as { id: string }).id });
  } catch (error) {
    logger.error('recordMerchantDocument threw', describeError(error));
    return fail<DocumentErrorKey, { documentId?: string }>('merchant.documents.errors.generic');
  }
}

/**
 * A signed URL so the merchant can open a document it uploaded.
 *
 * Sixty seconds, and minted on a click. Shorter than the admin's five minutes because there is no
 * review to conduct here — the merchant is confirming they uploaded the right file, which takes one
 * look. Nothing about this is a download endpoint for anybody else: the storage read policy still
 * requires the path to be in this merchant's folder.
 */
export async function signMyDocument(storagePath: string): Promise<string | null> {
  const merchant = await getMyMerchant();
  if (!merchant) return null;
  if (!storagePath.startsWith(`merchants/${merchant.id}/`)) return null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from('merchant-docs')
      .createSignedUrl(storagePath, 60);

    if (error) {
      logger.error('signMyDocument failed', { cause: error.message });
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (error) {
    logger.error('signMyDocument threw', describeError(error));
    return null;
  }
}
