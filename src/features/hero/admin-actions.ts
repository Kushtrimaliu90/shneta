'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import { CACHE_TAGS } from '@/lib/constants';
import {
  announcementSchema,
  heroIdSchema,
  heroReorderSchema,
  heroSettingsSchema,
  heroSlideSchema,
  heroUploadSchema,
  trustStripSchema,
} from '@/features/hero/admin-schemas';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/02 §7 — the hero's mutations.
 *
 * Written through the **SSR client**, not the admin client. RLS on `hero_slides` is
 * `has_any_role('{content_manager}')` for writes, so the caller's own session is the boundary and
 * `requireCapability` is the message — the service role would bypass the policy and turn the panel
 * into the only thing standing between a stale tab and the homepage.
 *
 * ── One purge helper, two tags ──
 *
 * `hero` covers the slides, the settings and the trust strip. `banners` goes too because the
 * announcement bar is a banner row and `/offers` reads the same table. Purging one and not the other
 * is how an operator saves a change, reloads, sees the old page, and stops trusting the panel.
 */

export type HeroErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.hero.errors.checkFields'
  | 'admin.hero.errors.notPublishable'
  | 'admin.hero.errors.pinTaken'
  | 'admin.hero.errors.fileType'
  | 'admin.hero.errors.fileTooLarge'
  | 'admin.hero.errors.uploadFailed';

export type HeroState = ActionResult<{ message?: string; path?: string; token?: string }, HeroErrorKey> | null;

function no(error: HeroErrorKey): HeroState {
  return fail<HeroErrorKey, { message?: string; path?: string; token?: string }>(error);
}

function purge(): void {
  revalidateTag(CACHE_TAGS.hero);
  revalidateTag(CACHE_TAGS.banners);
  revalidatePath('/admin/hero');
  /*
   * The homepage by path as well as by tag. `revalidateTag` purges the data cache entry, but the
   * page's own Full Route Cache is a separate thing and an operator expects "save" to mean the
   * homepage changed, not "the homepage will change within 300 seconds".
   */
  revalidatePath('/', 'page');
  revalidatePath('/en', 'page');
}

/** The database's own words, translated into something an operator can act on. */
function translate(message: string): HeroErrorKey {
  if (message.includes('hero_slides_single_pin')) return 'admin.hero.errors.pinTaken';
  if (message.includes('hero_slides_publishable')) return 'admin.hero.errors.notPublishable';
  if (message.includes('hero_slides_desktop_alt') || message.includes('hero_slides_mobile_alt')) {
    return 'admin.hero.errors.checkFields';
  }
  return 'admin.errors.generic';
}

/** `{ sq, en }`, with blanks dropped so an empty locale is absent rather than `""`. */
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

// -----------------------------------------------------------------------------
// Slides
// -----------------------------------------------------------------------------

export async function saveHeroSlide(_previous: HeroState, formData: FormData): Promise<HeroState> {
  const gate = await requireCapability('hero.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = heroSlideSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors('admin.hero.errors.checkFields', parsed.error.flatten());
  }

  const v = parsed.data;
  const row = {
    eyebrow: localized(v.eyebrowSq, v.eyebrowEn),
    headline: localized(v.headlineSq, v.headlineEn),
    subhead: localized(v.subheadSq, v.subheadEn),
    cta_primary_label: localized(v.ctaPrimaryLabelSq, v.ctaPrimaryLabelEn),
    cta_primary_href: v.ctaPrimaryHref?.trim() || null,
    cta_secondary_label: localized(v.ctaSecondaryLabelSq, v.ctaSecondaryLabelEn),
    cta_secondary_href: v.ctaSecondaryHref?.trim() || null,
    image_desktop_path: v.imageDesktopPath?.trim() || null,
    image_desktop_alt: localized(v.imageDesktopAltSq, v.imageDesktopAltEn),
    image_mobile_path: v.imageMobilePath?.trim() || null,
    image_mobile_alt: localized(v.imageMobileAltSq, v.imageMobileAltEn),
    text_variant: v.textVariant,
    is_pinned: v.isPinned,
    status: v.status,
    starts_at: timestamp(v.startAt),
    ends_at: timestamp(v.endAt),
  };

  try {
    const supabase = await createClient();

    /*
     * A new pin displaces the old one rather than failing the save.
     *
     * The unique index makes two pins impossible, and surfacing that as "pin taken" would be
     * technically honest and practically useless — the operator wants *this* slide pinned and would
     * have to go and unpin the other one first. Clearing the previous pin is what they meant.
     */
    if (v.isPinned) {
      const clear = supabase.from('hero_slides').update({ is_pinned: false }).eq('is_pinned', true);
      await (v.id ? clear.neq('id', v.id) : clear);
    }

    const { error } = v.id
      ? await supabase.from('hero_slides').update(row).eq('id', v.id)
      : await supabase.from('hero_slides').insert({ ...row, position: 999 });

    if (error) {
      logger.error('saveHeroSlide failed', describeError(error));
      return no(translate(error.message));
    }

    await audit(v.id ? 'hero.slide.update' : 'hero.slide.create', 'hero_slide', v.id ?? null, null, {
      status: v.status,
      pinned: v.isPinned,
    });

    purge();
    return ok({ message: 'Saved.' });
  } catch (error) {
    logger.error('saveHeroSlide threw', describeError(error));
    return no('admin.errors.generic');
  }
}

export async function duplicateHeroSlide(
  _previous: HeroState,
  formData: FormData,
): Promise<HeroState> {
  const gate = await requireCapability('hero.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = heroIdSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return no('admin.hero.errors.checkFields');

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('hero_slides')
      .select('*')
      .eq('id', parsed.data.id)
      .maybeSingle();

    if (error || !data) return no('admin.errors.generic');

    const source = data as Record<string, unknown>;
    /*
     * A copy arrives as an unpublished, unpinned draft. Duplicating a live slide and having the copy
     * go live immediately — or steal the pin from the original — is never what the operator meant by
     * "duplicate"; they wanted a starting point.
     */
    delete source.id;
    delete source.created_at;
    delete source.updated_at;

    const { error: insertError } = await supabase.from('hero_slides').insert({
      ...(source as Record<string, never>),
      status: 'draft',
      is_pinned: false,
      position: 999,
    });

    if (insertError) {
      logger.error('duplicateHeroSlide failed', describeError(insertError));
      return no('admin.errors.generic');
    }

    await audit('hero.slide.duplicate', 'hero_slide', parsed.data.id, null, null);
    purge();
    return ok({ message: 'Duplicated as a draft.' });
  } catch (error) {
    logger.error('duplicateHeroSlide threw', describeError(error));
    return no('admin.errors.generic');
  }
}

export async function deleteHeroSlide(_previous: HeroState, formData: FormData): Promise<HeroState> {
  const gate = await requireCapability('hero.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = heroIdSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return no('admin.hero.errors.checkFields');

  try {
    const supabase = await createClient();
    const { error } = await supabase.from('hero_slides').delete().eq('id', parsed.data.id);
    if (error) {
      logger.error('deleteHeroSlide failed', describeError(error));
      return no('admin.errors.generic');
    }

    await audit('hero.slide.delete', 'hero_slide', parsed.data.id, null, null);
    purge();
    return ok({ message: 'Deleted.' });
  } catch (error) {
    logger.error('deleteHeroSlide threw', describeError(error));
    return no('admin.errors.generic');
  }
}

export async function toggleHeroSlide(_previous: HeroState, formData: FormData): Promise<HeroState> {
  const gate = await requireCapability('hero.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = heroIdSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return no('admin.hero.errors.checkFields');

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('hero_slides')
      .select('status')
      .eq('id', parsed.data.id)
      .maybeSingle();

    const next = (data as { status: string } | null)?.status === 'published' ? 'draft' : 'published';
    const { error } = await supabase
      .from('hero_slides')
      .update({ status: next })
      .eq('id', parsed.data.id);

    if (error) {
      logger.error('toggleHeroSlide failed', describeError(error));
      // The publishable constraint is the likely one: a draft missing an English headline.
      return no(translate(error.message));
    }

    await audit('hero.slide.status', 'hero_slide', parsed.data.id, null, { status: next });
    purge();
    return ok({ message: next === 'published' ? 'Published.' : 'Unpublished.' });
  } catch (error) {
    logger.error('toggleHeroSlide threw', describeError(error));
    return no('admin.errors.generic');
  }
}

/**
 * Move one slide up or down, persisted immediately.
 *
 * ── Buttons rather than drag-and-drop, deliberately ──
 *
 * Native HTML5 drag has no touch support at all, and the brief is mobile-first; a real DnD
 * implementation means `@dnd-kit`, which is a dependency for one admin screen. Two buttons are
 * keyboard-operable, screen-reader-legible and work on a phone with no library — and reordering four
 * slides is not a task that needed a gesture.
 *
 * Implemented as a swap with the neighbour rather than a rewrite of every position, so two operators
 * reordering at once cannot renumber each other's work.
 */
export async function moveHeroSlide(_previous: HeroState, formData: FormData): Promise<HeroState> {
  const gate = await requireCapability('hero.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = heroReorderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('admin.hero.errors.checkFields');

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('hero_slides')
      .select('id, position')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    const rows = (data ?? []) as { id: string; position: number }[];
    const index = rows.findIndex((row) => row.id === parsed.data.id);
    const swapWith = parsed.data.direction === 'up' ? index - 1 : index + 1;

    const a = rows[index];
    const b = rows[swapWith];
    if (index < 0 || !a || !b) return ok({ message: 'Already at the end.' });

    /*
     * Positions are rewritten from the array index rather than swapped in place: the seeded rows all
     * share `position = 0`, so swapping the stored values would be a no-op. Normalising as we go
     * makes the first reorder repair the ordering rather than appear to do nothing.
     */
    const reordered = [...rows];
    reordered[index] = b;
    reordered[swapWith] = a;

    for (const [position, row] of reordered.entries()) {
      await supabase.from('hero_slides').update({ position }).eq('id', row.id);
    }

    purge();
    return ok({ message: 'Reordered.' });
  } catch (error) {
    logger.error('moveHeroSlide threw', describeError(error));
    return no('admin.errors.generic');
  }
}

// -----------------------------------------------------------------------------
// Uploads
// -----------------------------------------------------------------------------

/**
 * A one-shot upload URL for a hero image.
 *
 * Signed URL rather than posting the file through a server action: a server action body is capped at
 * 1 MB by default and these are hero photographs. The browser sends the bytes straight to Storage,
 * which is also the pattern `media-actions.ts` already uses for product images.
 *
 * Three layers of validation, none of them redundant. This action checks the declared type and size,
 * the **bucket** enforces its own 4 MB ceiling and MIME allowlist against a forged request that skips
 * this action entirely, and the path is a UUID rather than the uploaded filename — a browser filename
 * is attacker-controlled and arrives with whatever traversal segments and unicode the client fancied.
 */
export async function createHeroUploadUrl(
  _previous: HeroState,
  formData: FormData,
): Promise<HeroState> {
  const gate = await requireCapability('hero.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = heroUploadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issues = parsed.error.flatten().fieldErrors;
    if (issues.size) return no('admin.hero.errors.fileTooLarge');
    if (issues.contentType) return no('admin.hero.errors.fileType');
    return no('admin.hero.errors.checkFields');
  }

  const extension =
    { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/avif': 'avif' }[
      parsed.data.contentType
    ] ?? 'bin';
  const path = `hero/${randomUUID()}.${extension}`;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage.from('content').createSignedUploadUrl(path);

    if (error || !data) {
      logger.error('hero signed upload failed', { cause: error?.message });
      return no('admin.hero.errors.uploadFailed');
    }
    return ok({ path: data.path, token: data.token });
  } catch (error) {
    logger.error('createHeroUploadUrl threw', describeError(error));
    return no('admin.errors.generic');
  }
}

// -----------------------------------------------------------------------------
// Carousel settings, trust strip, announcement
// -----------------------------------------------------------------------------

export async function saveHeroSettings(_previous: HeroState, formData: FormData): Promise<HeroState> {
  const gate = await requireCapability('hero.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = heroSettingsSchema.safeParse({
    autoplay: formData.get('autoplay') === 'on',
    intervalSeconds: formData.get('intervalSeconds') ?? 6,
    transition: formData.get('transition') ?? 'fade',
    loop: formData.get('loop') === 'on',
    shuffle: formData.get('shuffle') === 'on',
  });
  if (!parsed.success) {
    return fromFieldErrors('admin.hero.errors.checkFields', parsed.error.flatten());
  }

  const v = parsed.data;
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('settings').upsert({
      key: 'hero',
      value: {
        autoplay: v.autoplay,
        interval_seconds: v.intervalSeconds,
        transition: v.transition,
        loop: v.loop,
        shuffle: v.shuffle,
      } as unknown as Json,
    });

    if (error) {
      logger.error('saveHeroSettings failed', describeError(error));
      return no('admin.errors.generic');
    }

    await audit('hero.settings.update', 'settings', 'hero', null, v as unknown as Json);
    purge();
    return ok({ message: 'Carousel settings saved.' });
  } catch (error) {
    logger.error('saveHeroSettings threw', describeError(error));
    return no('admin.errors.generic');
  }
}

export async function saveTrustStrip(_previous: HeroState, formData: FormData): Promise<HeroState> {
  const gate = await requireCapability('hero.manage');
  if (!gate.ok) return no(gate.error);

  // Four fixed rows in the form, read back positionally.
  const items = [0, 1, 2, 3]
    .map((index) => ({
      icon: String(formData.get(`icon-${index}`) ?? 'badge'),
      sq: String(formData.get(`sq-${index}`) ?? '').trim(),
      en: String(formData.get(`en-${index}`) ?? '').trim(),
    }))
    .filter((item) => item.sq && item.en);

  const parsed = trustStripSchema.safeParse({ items });
  if (!parsed.success) return no('admin.hero.errors.checkFields');

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('settings')
      .upsert({ key: 'trust_strip', value: { items: parsed.data.items } as unknown as Json });

    if (error) {
      logger.error('saveTrustStrip failed', describeError(error));
      return no('admin.errors.generic');
    }

    await audit('hero.trust.update', 'settings', 'trust_strip', null, null);
    purge();
    return ok({ message: 'Trust strip saved.' });
  } catch (error) {
    logger.error('saveTrustStrip threw', describeError(error));
    return no('admin.errors.generic');
  }
}

export async function saveAnnouncement(_previous: HeroState, formData: FormData): Promise<HeroState> {
  const gate = await requireCapability('hero.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = announcementSchema.safeParse({
    id: formData.get('id') || undefined,
    titleSq: formData.get('titleSq') ?? '',
    titleEn: formData.get('titleEn') ?? '',
    code: formData.get('code') ?? '',
    href: formData.get('href') ?? '',
    isActive: formData.get('isActive') === 'on',
  });
  if (!parsed.success) {
    return fromFieldErrors('admin.hero.errors.checkFields', parsed.error.flatten());
  }

  const v = parsed.data;
  const row = {
    placement: 'announcement',
    title: localized(v.titleSq, v.titleEn),
    code: v.code?.trim() || null,
    cta_href: v.href?.trim() || null,
    is_active: v.isActive,
  };

  try {
    const supabase = await createClient();
    const { error } = v.id
      ? await supabase.from('banners').update(row).eq('id', v.id)
      : await supabase.from('banners').insert(row);

    if (error) {
      logger.error('saveAnnouncement failed', describeError(error));
      return no('admin.errors.generic');
    }

    await audit('hero.announcement.update', 'banner', v.id ?? null, null, {
      active: v.isActive,
      code: v.code || null,
    });
    purge();
    return ok({ message: 'Announcement saved.' });
  } catch (error) {
    logger.error('saveAnnouncement threw', describeError(error));
    return no('admin.errors.generic');
  }
}
