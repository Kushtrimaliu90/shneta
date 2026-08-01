'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { revalidatePublic } from '@/lib/cache';
import { CACHE_TAGS } from '@/lib/constants';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/06 §14 — the certifications registry.
 *
 * Deferred from M6 with the note that creating a certification is "a once-a-quarter act better
 * done with a migration than a screen" (docs/14 §9). That was right about the frequency and wrong
 * about the consequence: a migration needs an engineer, and the person who knows that a supplier
 * has just gained an ISO certificate is a compliance manager. So it is a screen — a small one.
 *
 * Compliance owns it, not the product manager: attaching a certification to a product is a claim
 * about the product, and docs/01 §3 puts claims with compliance.
 */

export type CertificationErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.certifications.errors.checkFields'
  | 'admin.certifications.errors.slugTaken'
  | 'admin.certifications.errors.inUse';

export type CertificationState = ActionResult<{ id?: string }, CertificationErrorKey> | null;

function certFail(error: CertificationErrorKey): CertificationState {
  return fail<CertificationErrorKey, { id?: string }>(error);
}

const certificationSchema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'At least two characters.')
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens.'),
  nameSq: z.string().trim().min(2, 'Required.').max(80),
  nameEn: z.string().trim().max(80).optional().or(z.literal('')),
});

export async function saveCertification(
  _previous: CertificationState,
  formData: FormData,
): Promise<CertificationState> {
  const gate = await requireCapability('compliance.approve');
  if (!gate.ok) return certFail(gate.error);

  const parsed = certificationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<CertificationErrorKey, { id?: string }>(
      'admin.certifications.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const input = parsed.data;
  const patch = {
    slug: input.slug,
    name: (input.nameEn ? { sq: input.nameSq, en: input.nameEn } : { sq: input.nameSq }) as Json,
  };

  try {
    const supabase = await createClient();

    if (input.id) {
      const { error } = await supabase.from('certifications').update(patch).eq('id', input.id);
      if (error) {
        if (error.code === '23505') return certFail('admin.certifications.errors.slugTaken');
        logger.error('saveCertification update failed', { cause: error.message });
        return certFail('admin.errors.generic');
      }
      await audit('certification.update', 'certification', input.id, null, patch);
    } else {
      const { data, error } = await supabase
        .from('certifications')
        .insert(patch)
        .select('id')
        .single();

      if (error) {
        if (error.code === '23505') return certFail('admin.certifications.errors.slugTaken');
        logger.error('saveCertification insert failed', { cause: error.message });
        return certFail('admin.errors.generic');
      }
      await audit('certification.create', 'certification', (data as { id: string }).id, null, patch);
    }

    // Badges render on the PDP, so the catalogue tag goes.
    revalidatePublic([CACHE_TAGS.products]);
    revalidatePath('/admin/compliance');
    return ok({ id: input.id || undefined });
  } catch (error) {
    logger.error('saveCertification threw', describeError(error));
    return certFail('admin.errors.generic');
  }
}

/**
 * Deletes a certification — but only one nothing carries.
 *
 * `product_certifications` has no `on delete cascade`, so a delete would fail at the foreign key
 * anyway; checking first turns a Postgres error nobody can act on into a sentence that says which
 * products are in the way.
 */
export async function deleteCertification(
  _previous: CertificationState,
  formData: FormData,
): Promise<CertificationState> {
  const gate = await requireCapability('compliance.approve');
  if (!gate.ok) return certFail(gate.error);

  const id = String(formData.get('id') ?? '');
  if (!z.string().uuid().safeParse(id).success) return certFail('admin.errors.generic');

  try {
    const supabase = await createClient();

    const { count } = await supabase
      .from('product_certifications')
      .select('product_id', { count: 'exact', head: true })
      .eq('certification_id', id);

    if ((count ?? 0) > 0) return certFail('admin.certifications.errors.inUse');

    const { error } = await supabase.from('certifications').delete().eq('id', id);
    if (error) {
      logger.error('deleteCertification failed', { cause: error.message });
      return certFail('admin.errors.generic');
    }

    await audit('certification.delete', 'certification', id, null, null);

    revalidatePublic([CACHE_TAGS.products]);
    revalidatePath('/admin/compliance');
    return ok({});
  } catch (error) {
    logger.error('deleteCertification threw', describeError(error));
    return certFail('admin.errors.generic');
  }
}
