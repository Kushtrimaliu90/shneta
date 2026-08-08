import { describe, expect, it } from 'vitest';
import {
  announcementSchema,
  heroSettingsSchema,
  heroSlideSchema,
} from '@/features/hero/admin-schemas';

/**
 * The publish rules, which are the part of the hero an operator can get wrong at 11pm.
 *
 * Each of these is also a check constraint in migration 73. Both layers matter and they guard
 * different things: the constraint makes the bad row impossible for any caller, and this makes the
 * refusal land on the right field with a sentence instead of a constraint name.
 */

function slide(overrides: Record<string, unknown> = {}) {
  return heroSlideSchema.safeParse({
    headlineSq: 'Biologjia jote ka një kod.',
    headlineEn: 'Your biology has a code.',
    ctaPrimaryLabelSq: 'Shiko produktet',
    ctaPrimaryLabelEn: 'Shop the range',
    ctaPrimaryHref: '/shop',
    imageDesktopPath: '/hero/lineup.webp',
    imageDesktopAltSq: 'Gama e produkteve',
    status: 'published',
    ...overrides,
  });
}

function badFields(result: ReturnType<typeof slide>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('publishing a hero slide', () => {
  it('accepts a complete slide', () => {
    expect(slide().success).toBe(true);
  });

  it('refuses a published slide with no Albanian headline', () => {
    expect(badFields(slide({ headlineSq: '' }))).toContain('headlineSq');
  });

  it('refuses a published slide with no English headline', () => {
    /*
     * The brief only asked to block on Albanian. English matters for the same reason: a published
     * slide with no English headline renders a blank space on `/en` rather than falling back, so a
     * half-translated slide is unpublishable in either direction.
     */
    expect(badFields(slide({ headlineEn: '' }))).toContain('headlineEn');
  });

  it('refuses a published slide with no primary CTA', () => {
    expect(badFields(slide({ ctaPrimaryHref: '' }))).toContain('ctaPrimaryHref');
  });

  it('refuses a published slide with no desktop image', () => {
    expect(badFields(slide({ imageDesktopPath: '' }))).toContain('imageDesktopPath');
  });

  it('allows a draft to be incomplete', () => {
    // A draft is a work in progress. Blocking a save is how a half-written slide gets lost.
    const result = slide({ status: 'draft', headlineEn: '', ctaPrimaryHref: '', imageDesktopPath: '' });
    expect(result.success).toBe(true);
  });

  it('requires alt text as soon as there is an image, draft or not', () => {
    // Tied to the image rather than to publishing, so the ask arrives while the person can still see
    // what they just uploaded.
    const result = slide({ status: 'draft', imageDesktopAltSq: '' });
    expect(badFields(result)).toContain('imageDesktopAltSq');
  });

  it('requires alt text on the mobile crop too', () => {
    expect(badFields(slide({ imageMobilePath: 'hero/x.webp' }))).toContain('imageMobileAltSq');
  });

  it('refuses an end date at or before the start', () => {
    const result = slide({ startAt: '2026-09-01T10:00', endAt: '2026-09-01T09:00' });
    expect(badFields(result)).toContain('endAt');
  });

  it('refuses a CTA that leaves the site', () => {
    // These go straight into a Link href. Protocol-relative is the one people forget: it has a
    // leading slash and is still off-site.
    expect(slide({ ctaPrimaryHref: 'https://evil.example' }).success).toBe(false);
    expect(slide({ ctaPrimaryHref: '//evil.example' }).success).toBe(false);
  });
});

describe('carousel settings', () => {
  it('holds the interval inside 3–15 seconds', () => {
    expect(heroSettingsSchema.safeParse({ intervalSeconds: 2 }).success).toBe(false);
    expect(heroSettingsSchema.safeParse({ intervalSeconds: 16 }).success).toBe(false);
    expect(heroSettingsSchema.safeParse({ intervalSeconds: 6 }).success).toBe(true);
  });

  it('defaults everything, so a partial form cannot produce a broken carousel', () => {
    const parsed = heroSettingsSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.intervalSeconds).toBe(6);
    expect(parsed.success && parsed.data.transition).toBe('fade');
  });
});

/**
 * Optional fields, where blank and whitespace must mean the same thing.
 *
 * `.optional().or(z.literal(''))` is the obvious spelling and is subtly wrong: a union tests each
 * branch against the **raw** input, so `z.literal('')` sees `' '` rather than the trimmed value. One
 * stray space in a field the operator never knowingly filled in then failed the save — and, before
 * the field errors were rendered, failed it silently.
 */
describe('optional hero fields', () => {
  it('accepts a blank link', () => {
    expect(announcementSchema.safeParse({ href: '' }).success).toBe(true);
  });

  it('accepts a whitespace-only link as blank', () => {
    expect(announcementSchema.safeParse({ href: '   ' }).success).toBe(true);
  });

  it('accepts the field being absent entirely', () => {
    // A control that is not rendered submits nothing at all, which must not read as invalid.
    expect(announcementSchema.safeParse({}).success).toBe(true);
  });

  it('still refuses a link that is not a site path', () => {
    const result = announcementSchema.safeParse({ href: 'offers' });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.message).toContain('/offers');
  });

  it('still refuses an off-site link', () => {
    expect(announcementSchema.safeParse({ href: 'https://evil.example' }).success).toBe(false);
    expect(announcementSchema.safeParse({ href: '//evil.example' }).success).toBe(false);
  });
});
