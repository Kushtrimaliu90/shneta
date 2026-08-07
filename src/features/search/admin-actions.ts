'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import { CACHE_TAGS } from '@/lib/constants';
import {
  idSchema,
  searchRedirectSchema,
  searchRuleSchema,
  synonymGroupSchema,
} from '@/features/search/admin-schemas';

/**
 * docs/02 §7 — the search console's mutations.
 *
 * Every one is: check the capability, parse, write through the caller's session so RLS is the real
 * guard, audit, purge. The RLS policies on all three tables are `has_any_role('{product_manager,
 * content_manager}')`, so the capability check here is the message, not the boundary.
 *
 * ── Two caches to purge, not one ──
 *
 * `CACHE_TAGS.search` covers the redirect table the storefront holds. `CACHE_TAGS.products` has to go
 * too, because a synonym edit or a merchandising rule changes what `search_products` *returns* — and
 * every listing on the site is cached under that tag. Purging only `search` would leave the shop grid
 * serving pre-rule ordering until the ISR window expired, which is exactly the sort of "it didn't work,
 * oh wait now it has" that makes an operator stop trusting the panel.
 */

export type SearchAdminErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.search.errors.checkFields'
  | 'admin.search.errors.duplicate';

export type SearchAdminState = ActionResult<{ message?: string }, SearchAdminErrorKey> | null;

function purge(): void {
  revalidateTag(CACHE_TAGS.search);
  revalidateTag(CACHE_TAGS.products);
  revalidatePath('/admin/search');
}

/** Postgres 23505 is a unique violation — the only write error here an operator can fix themselves. */
function translate(message: string): SearchAdminErrorKey {
  return message.includes('duplicate key') || message.includes('23505')
    ? 'admin.search.errors.duplicate'
    : 'admin.errors.generic';
}

// -----------------------------------------------------------------------------
// Synonyms
// -----------------------------------------------------------------------------

export async function saveSynonymGroup(
  _prev: SearchAdminState,
  formData: FormData,
): Promise<SearchAdminState> {
  const guard = await requireCapability('search.manage');
  if (!guard.ok) return fail(guard.error);

  const parsed = synonymGroupSchema.safeParse({
    id: formData.get('id') || undefined,
    label: formData.get('label') ?? '',
    terms: formData.get('terms') ?? '',
    note: formData.get('note') ?? '',
    isActive: formData.get('isActive') === 'on',
  });

  if (!parsed.success) {
    return fromFieldErrors('admin.search.errors.checkFields', parsed.error.flatten());
  }

  const { id, label, terms, note, isActive } = parsed.data;
  const supabase = await createClient();
  const row = { label, terms, note: note || null, is_active: isActive };

  const { error } = id
    ? await supabase.from('search_synonym_groups').update(row).eq('id', id)
    : await supabase.from('search_synonym_groups').insert(row);

  if (error) {
    logger.error('saveSynonymGroup failed', describeError(error));
    return fail(translate(error.message));
  }

  await audit(
    id ? 'search.synonym.update' : 'search.synonym.create',
    'search_synonym_group',
    id ?? null,
    null,
    { label, terms, isActive },
  );

  /*
   * The statement trigger from migration 65 has already re-indexed the whole catalogue by the time this
   * returns, so the purge below is publishing a change that is fully applied rather than racing it.
   */
  purge();
  return ok({ message: 'Saved. The catalogue has been re-indexed.' });
}

export async function deleteSynonymGroup(
  _prev: SearchAdminState,
  formData: FormData,
): Promise<SearchAdminState> {
  const guard = await requireCapability('search.manage');
  if (!guard.ok) return fail(guard.error);

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return fail('admin.search.errors.checkFields');

  const supabase = await createClient();
  const { error } = await supabase.from('search_synonym_groups').delete().eq('id', parsed.data.id);

  if (error) {
    logger.error('deleteSynonymGroup failed', describeError(error));
    return fail('admin.errors.generic');
  }

  await audit('search.synonym.delete', 'search_synonym_group', parsed.data.id, null, null);

  purge();
  return ok({ message: 'Removed. The catalogue has been re-indexed.' });
}

// -----------------------------------------------------------------------------
// Merchandising rules
// -----------------------------------------------------------------------------

export async function saveSearchRule(
  _prev: SearchAdminState,
  formData: FormData,
): Promise<SearchAdminState> {
  const guard = await requireCapability('search.manage');
  if (!guard.ok) return fail(guard.error);

  const parsed = searchRuleSchema.safeParse({
    action: formData.get('action') ?? '',
    productId: formData.get('productId') ?? '',
    matchType: formData.get('matchType') ?? 'exact',
    query: formData.get('query') ?? '',
    pinPosition: formData.get('pinPosition') || undefined,
    weight: formData.get('weight') || undefined,
    note: formData.get('note') ?? '',
  });

  if (!parsed.success) {
    return fromFieldErrors('admin.search.errors.checkFields', parsed.error.flatten());
  }

  const value = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.from('search_rules').insert({
    action: value.action,
    product_id: value.productId,
    match_type: value.matchType,
    query: value.matchType === 'any' ? null : (value.query ?? null),
    pin_position: value.action === 'pin' ? (value.pinPosition ?? null) : null,
    // `hide` carries no weight, and a stray one would sit in the table implying it did something.
    weight: value.action === 'boost' || value.action === 'bury' ? (value.weight ?? 0) : 0,
    note: value.note || null,
    created_by: guard.actor.id,
  });

  if (error) {
    logger.error('saveSearchRule failed', describeError(error));
    return fail(translate(error.message));
  }

  await audit('search.rule.create', 'search_rule', null, null, {
    ruleAction: value.action,
    query: value.query ?? null,
    productId: value.productId,
  });

  purge();
  return ok({ message: 'Rule saved.' });
}

export async function deleteSearchRule(
  _prev: SearchAdminState,
  formData: FormData,
): Promise<SearchAdminState> {
  const guard = await requireCapability('search.manage');
  if (!guard.ok) return fail(guard.error);

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return fail('admin.search.errors.checkFields');

  const supabase = await createClient();
  const { error } = await supabase.from('search_rules').delete().eq('id', parsed.data.id);

  if (error) {
    logger.error('deleteSearchRule failed', describeError(error));
    return fail('admin.errors.generic');
  }

  await audit('search.rule.delete', 'search_rule', parsed.data.id, null, null);

  purge();
  return ok({ message: 'Rule removed.' });
}

// -----------------------------------------------------------------------------
// Redirects
// -----------------------------------------------------------------------------

export async function saveSearchRedirect(
  _prev: SearchAdminState,
  formData: FormData,
): Promise<SearchAdminState> {
  const guard = await requireCapability('search.manage');
  if (!guard.ok) return fail(guard.error);

  const parsed = searchRedirectSchema.safeParse({
    query: formData.get('query') ?? '',
    matchType: formData.get('matchType') ?? 'contains',
    destinationPath: formData.get('destinationPath') ?? '',
    note: formData.get('note') ?? '',
  });

  if (!parsed.success) {
    return fromFieldErrors('admin.search.errors.checkFields', parsed.error.flatten());
  }

  const value = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.from('search_redirects').insert({
    query: value.query,
    match_type: value.matchType,
    destination_path: value.destinationPath,
    note: value.note || null,
    created_by: guard.actor.id,
  });

  if (error) {
    logger.error('saveSearchRedirect failed', describeError(error));
    return fail(translate(error.message));
  }

  await audit('search.redirect.create', 'search_redirect', null, null, {
    query: value.query,
    destination: value.destinationPath,
  });

  purge();
  return ok({ message: 'Redirect saved.' });
}

export async function deleteSearchRedirect(
  _prev: SearchAdminState,
  formData: FormData,
): Promise<SearchAdminState> {
  const guard = await requireCapability('search.manage');
  if (!guard.ok) return fail(guard.error);

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return fail('admin.search.errors.checkFields');

  const supabase = await createClient();
  const { error } = await supabase.from('search_redirects').delete().eq('id', parsed.data.id);

  if (error) {
    logger.error('deleteSearchRedirect failed', describeError(error));
    return fail('admin.errors.generic');
  }

  await audit('search.redirect.delete', 'search_redirect', parsed.data.id, null, null);

  purge();
  return ok({ message: 'Redirect removed.' });
}
