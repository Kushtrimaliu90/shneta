'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import { CACHE_TAGS } from '@/lib/constants';
import {
  placementIdSchema,
  placementSchema,
  placementStatusSchema,
  placementUploadSchema,
} from '@/features/placements/admin-schemas';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/02 §7 — the placement mutations.
 *
 * Through the caller's session, so RLS is the boundary and `requireCapability` is the message. The
 * write policy on `ad_placements` is `content_manager`, which is the role that already reviews copy
 * for the health-claim rules in docs/08 §7 — the same judgement an advertiser's creative needs.
 */

export type PlacementErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.placements.errors.checkFields'
  | 'admin.placements.errors.notApprovable'
  | 'admin.placements.errors.fileType'
  | 'admin.placements.errors.fileTooLarge'
  | 'admin.placements.errors.uploadFailed';

export type PlacementState = ActionResult<
  { message?: string; path?: string; token?: string },
  PlacementErrorKey
> | null;

function no(error: PlacementErrorKey): PlacementState {
  return fail<PlacementErrorKey, { message?: string; path?: string; token?: string }>(error);
}

function purge(): void {
  revalidateTag(CACHE_TAGS.placements);
  revalidatePath('/admin/placements');
  /*
   * Every listing page, by tag. A placement can target all of them, so purging one path would leave
   * the rest serving a campaign that has started or ended — and an advertiser billed by the day
   * notices that.
   */
  revalidateTag(CACHE_TAGS.products);
}

function localized(sq: string | undefined, en: string | undefined): Json {
  const out: Record<string, string> = {};
  if (sq?.trim()) out.sq = sq.trim();
  if (en?.trim()) out.en = en.trim();
  return out as unknown as Json;
}

function timestamp(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
}

export async function savePlacement(
  _previous: PlacementState,
  formData: FormData,
): Promise<PlacementState> {
  const gate = await requireCapability('placements.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = placementSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors('admin.placements.errors.checkFields', parsed.error.flatten());
  }

  const v = parsed.data;
  const approving = v.status === 'approved';

  const row = {
    advertiser_name: v.advertiserName,
    internal_note: v.internalNote?.trim() || null,
    headline: localized(v.headlineSq, v.headlineEn),
    subhead: localized(v.subheadSq, v.subheadEn),
    cta_label: localized(v.ctaLabelSq, v.ctaLabelEn),
    destination_url: v.destinationUrl,
    open_in_new_tab: v.openInNewTab,
    image_desktop_path: v.imageDesktopPath?.trim() || null,
    image_desktop_alt: localized(v.imageDesktopAltSq, v.imageDesktopAltEn),
    image_mobile_path: v.imageMobilePath?.trim() || null,
    image_mobile_alt: localized(v.imageMobileAltSq, v.imageMobileAltEn),
    is_paid: v.isPaid,
    status: v.status,
    target_category_slugs: v.targetCategorySlugs,
    target_brand_slugs: v.targetBrandSlugs,
    weight: v.weight,
    starts_at: timestamp(v.startAt),
    ends_at: timestamp(v.endAt),
    /*
     * Who approved it and when, stamped here rather than left to a trigger — the audit row below
     * records the act, and these two columns are what a merchant dispute would be answered from.
     */
    ...(approving ? { approved_by: gate.actor.id, approved_at: new Date().toISOString() } : {}),
  };

  try {
    const supabase = await createClient();
    const { error } = v.id
      ? await supabase.from('ad_placements').update(row).eq('id', v.id)
      : await supabase.from('ad_placements').insert(row);

    if (error) {
      logger.error('savePlacement failed', describeError(error));
      return no(
        error.message.includes('ad_placements_approvable')
          ? 'admin.placements.errors.notApprovable'
          : 'admin.errors.generic',
      );
    }

    await audit(v.id ? 'placement.update' : 'placement.create', 'ad_placement', v.id ?? null, null, {
      advertiser: v.advertiserName,
      status: v.status,
      is_paid: v.isPaid,
    });

    purge();
    return ok({ message: approving ? 'Approved and live.' : 'Saved.' });
  } catch (error) {
    logger.error('savePlacement threw', describeError(error));
    return no('admin.errors.generic');
  }
}

/**
 * Move a placement through draft → pending review → approved.
 *
 * A separate action from the editor because the reviewer is often not the author: somebody prepares
 * the creative and somebody else decides it may run. Approving from a list, without opening a form
 * that could change what is being approved, is the difference between a review and an edit.
 */
export async function setPlacementStatus(
  _previous: PlacementState,
  formData: FormData,
): Promise<PlacementState> {
  const gate = await requireCapability('placements.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = placementStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('admin.placements.errors.checkFields');

  const { id, status } = parsed.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('ad_placements')
      .update({
        status,
        ...(status === 'approved'
          ? { approved_by: gate.actor.id, approved_at: new Date().toISOString() }
          : {}),
      })
      .eq('id', id);

    if (error) {
      logger.error('setPlacementStatus failed', describeError(error));
      // The approvable constraint: approving something with no creative.
      return no(
        error.message.includes('ad_placements_approvable')
          ? 'admin.placements.errors.notApprovable'
          : 'admin.errors.generic',
      );
    }

    await audit('placement.status', 'ad_placement', id, null, { status });
    purge();
    return ok({ message: status === 'approved' ? 'Approved and live.' : 'Status updated.' });
  } catch (error) {
    logger.error('setPlacementStatus threw', describeError(error));
    return no('admin.errors.generic');
  }
}

export async function deletePlacement(
  _previous: PlacementState,
  formData: FormData,
): Promise<PlacementState> {
  const gate = await requireCapability('placements.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = placementIdSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return no('admin.placements.errors.checkFields');

  try {
    const supabase = await createClient();
    const { error } = await supabase.from('ad_placements').delete().eq('id', parsed.data.id);

    if (error) {
      logger.error('deletePlacement failed', describeError(error));
      return no('admin.errors.generic');
    }

    /*
     * The stats go with it — `on delete cascade`. That is correct for a placement created by
     * mistake and wrong for one that ran and was billed, which is why the list offers *expiry*
     * as the ordinary end of a campaign: an expired placement stays in the table with its numbers
     * intact and simply stops being served.
     */
    await audit('placement.delete', 'ad_placement', parsed.data.id, null, null);
    purge();
    return ok({ message: 'Deleted, along with its counts.' });
  } catch (error) {
    logger.error('deletePlacement threw', describeError(error));
    return no('admin.errors.generic');
  }
}

/**
 * A one-shot upload URL for a creative.
 *
 * Signed URL rather than posting bytes through a server action, whose body is capped at 1 MB. Three
 * layers of validation: here on the declared type and size, in the browser on the *dimensions* before
 * anything is sent, and at the bucket, which enforces its own ceiling and MIME allowlist against a
 * request that skipped both.
 */
export async function createPlacementUploadUrl(
  _previous: PlacementState,
  formData: FormData,
): Promise<PlacementState> {
  const gate = await requireCapability('placements.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = placementUploadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issues = parsed.error.flatten().fieldErrors;
    if (issues.size) return no('admin.placements.errors.fileTooLarge');
    if (issues.contentType) return no('admin.placements.errors.fileType');
    return no('admin.placements.errors.checkFields');
  }

  const extension =
    { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/avif': 'avif' }[
      parsed.data.contentType
    ] ?? 'bin';

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from('content')
      .createSignedUploadUrl(`placements/${randomUUID()}.${extension}`);

    if (error || !data) {
      logger.error('placement signed upload failed', { cause: error?.message });
      return no('admin.placements.errors.uploadFailed');
    }
    return ok({ path: data.path, token: data.token });
  } catch (error) {
    logger.error('createPlacementUploadUrl threw', describeError(error));
    return no('admin.errors.generic');
  }
}
