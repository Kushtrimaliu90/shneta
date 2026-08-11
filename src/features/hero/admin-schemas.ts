import { z } from 'zod';

/**
 * docs/02 §7 — every hero mutation validates here.
 *
 * These mirror the check constraints in migration 73 rather than replacing them. The constraint is
 * what makes a bad row impossible for *any* caller; this is what makes the refusal land on the right
 * input with a sentence an operator can act on, instead of a constraint name in a red box.
 */

const trimmed = z.string().trim();

/**
 * An optional text field, where blank means absent.
 *
 * Not `.optional().or(z.literal(''))`, which is the obvious spelling and is subtly wrong: the union
 * branches each receive the **raw** input, so `z.literal('')` is tested against ` ` rather than
 * against the trimmed value. One stray space in an optional field then fails validation with a message
 * about a field the operator did not knowingly fill in.
 *
 * Blanking to `undefined` before anything else runs makes whitespace and empty identical, which is
 * what an operator means by both.
 */
const blankToUndefined = z
  .string()
  .optional()
  /*
   * `.optional()` on the *input*, not after the pipe. `.pipe(x.optional())` only makes the piped
   * stage tolerant — the outer field is still required, so an absent key errors with "expected
   * string, received undefined". A checkbox that is not ticked and a field that is not rendered both
   * arrive absent, so that distinction matters more than it looks.
   */
  .transform((value) => {
    const text = (value ?? '').trim();
    return text === '' ? undefined : text;
  });

const localized = (max: number) => blankToUndefined.pipe(z.string().max(max).optional());

/**
 * Site-relative only, and optional. These strings go straight into a `<Link href>`.
 *
 * The message names the shape rather than reciting the rule, because the mistake it catches is
 * someone typing `offers` where the placeholder shows `/offers`.
 */
const sitePath = blankToUndefined.pipe(
  z
    .string()
    .max(200)
    .regex(/^\/(?!\/)[\w\-/?=&.%]*$/, 'Must start with a single “/” — for example /offers.')
    .optional(),
);

export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png', 'image/avif'] as const;

/** Mirrors the `content` bucket's own ceiling, so the browser is told before it sends 4 MB. */
export const heroUploadSchema = z.object({
  contentType: z.enum(IMAGE_TYPES),
  size: z.coerce.number().int().positive().max(IMAGE_MAX_BYTES),
});

export const heroSlideSchema = z
  .object({
    id: z.uuid().optional(),

    eyebrowSq: localized(80),
    eyebrowEn: localized(80),
    headlineSq: localized(120),
    headlineEn: localized(120),
    subheadSq: localized(400),
    subheadEn: localized(400),

    ctaPrimaryLabelSq: localized(40),
    ctaPrimaryLabelEn: localized(40),
    ctaPrimaryHref: sitePath,
    ctaSecondaryLabelSq: localized(40),
    ctaSecondaryLabelEn: localized(40),
    ctaSecondaryHref: sitePath,

    imageDesktopPath: localized(300),
    imageDesktopAltSq: localized(200),
    imageDesktopAltEn: localized(200),
    imageMobilePath: localized(300),
    imageMobileAltSq: localized(200),
    imageMobileAltEn: localized(200),

    textVariant: z.enum(['light', 'dark']).default('dark'),
    isPinned: z.coerce.boolean().default(false),
    status: z.enum(['draft', 'published']).default('draft'),

    startAt: blankToUndefined,
    endAt: blankToUndefined,
  })
  .superRefine((value, ctx) => {
    const has = (field: string | undefined) => Boolean(field?.trim());

    /*
     * Alt text is tied to the image, not to publishing.
     *
     * Requiring it only at publish lets a draft accumulate images with no descriptions, and then the
     * whole thing fails at once at the moment somebody is trying to ship a campaign. Requiring it
     * with the upload means the ask arrives while the person can still see what they just chose.
     */
    if (has(value.imageDesktopPath) && !has(value.imageDesktopAltSq)) {
      ctx.addIssue({ code: 'custom', path: ['imageDesktopAltSq'], message: 'Alt text is required.' });
    }
    if (has(value.imageMobilePath) && !has(value.imageMobileAltSq)) {
      ctx.addIssue({ code: 'custom', path: ['imageMobileAltSq'], message: 'Alt text is required.' });
    }

    if (has(value.startAt) && has(value.endAt)) {
      const start = new Date(value.startAt ?? '');
      const end = new Date(value.endAt ?? '');
      if (Number.isFinite(start.valueOf()) && Number.isFinite(end.valueOf()) && end <= start) {
        ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'Must be after the start.' });
      }
    }

    if (value.status !== 'published') return;

    /*
     * What "published" requires. Both locales, not just Albanian: a slide with no English headline
     * renders a blank space on `/en` rather than falling back to anything, so a half-translated slide
     * is not publishable in either direction.
     */
    const required: [string, string | undefined][] = [
      ['headlineSq', value.headlineSq],
      ['headlineEn', value.headlineEn],
      ['ctaPrimaryLabelSq', value.ctaPrimaryLabelSq],
      ['ctaPrimaryLabelEn', value.ctaPrimaryLabelEn],
      ['ctaPrimaryHref', value.ctaPrimaryHref],
      ['imageDesktopPath', value.imageDesktopPath],
    ];

    for (const [path, field] of required) {
      if (!has(field)) {
        ctx.addIssue({
          code: 'custom',
          path: [path],
          message: 'Required before this slide can be published.',
        });
      }
    }
  });

export const heroSettingsSchema = z.object({
  autoplay: z.coerce.boolean().default(false),
  // The public reader clamps to the same range; a settings row is reachable from psql too.
  intervalSeconds: z.coerce.number().int().min(3).max(15).default(6),
  transition: z.enum(['fade', 'slide']).default('fade'),
  loop: z.coerce.boolean().default(false),
  shuffle: z.coerce.boolean().default(false),
});

export const heroReorderSchema = z.object({
  id: z.uuid(),
  direction: z.enum(['up', 'down']),
});

export const heroIdSchema = z.object({ id: z.uuid() });

export const trustStripSchema = z.object({
  items: z
    .array(
      z.object({
        icon: z.enum(['truck', 'clock', 'flask', 'rotate', 'badge', 'wallet']),
        sq: trimmed.min(1).max(80),
        en: trimmed.min(1).max(80),
      }),
    )
    .min(1)
    .max(6),
});

export const announcementSchema = z.object({
  id: z.uuid().optional(),
  titleSq: localized(160),
  titleEn: localized(160),
  linkLabel: localized(40),
  href: sitePath,
  isActive: z.coerce.boolean().default(false),
});

/**
 * The four homepage entry tiles (migration 81).
 *
 * Mirrors `trustStripSchema` in shape and differs in what a tile carries: a bilingual title and body, a
 * destination, and an icon. `sitePath` is reused rather than a looser string — these become `<Link href>`
 * on the most prominent navigation on the site, and the same off-site and protocol-relative rules apply.
 *
 * One to six tiles. The band is a four-column grid at `lg` and stacks below it, so five or six still read
 * as a band rather than a list; zero would leave the homepage with no route in below the hero, which is
 * the thing this band exists to provide.
 */
export const INTENT_ICONS = ['target', 'star', 'tag', 'sparkles', 'flask', 'leaf', 'truck', 'badge'] as const;

export const intentBandSchema = z.object({
  items: z
    .array(
      z.object({
        icon: z.enum(INTENT_ICONS),
        /** Required here, unlike an optional CTA: a tile with no destination is not a route. */
        href: trimmed
          .min(1)
          .max(200)
          .regex(/^\/(?!\/)[\w\-/?=&.%]*$/, 'Must start with a single “/” — for example /offers.'),
        titleSq: trimmed.min(1).max(60),
        titleEn: trimmed.min(1).max(60),
        bodySq: trimmed.min(1).max(120),
        bodyEn: trimmed.min(1).max(120),
      }),
    )
    .min(1)
    .max(6),
});
