import { z } from 'zod';

/**
 * docs/02 §7 — placement validation, mirroring the check constraints in migration 76.
 *
 * The constraints make a bad row impossible for any caller; these make the refusal land on the right
 * input with a sentence an operator can act on.
 */

const trimmed = z.string().trim();
const localized = (max: number) => trimmed.max(max).optional().or(z.literal(''));

/** Comma or newline separated slugs. Empty means "every listing page". */
const slugList = trimmed
  .optional()
  .or(z.literal(''))
  .transform((value) =>
    (value ?? '')
      .split(/[\n,]/)
      .map((slug) => slug.trim().toLowerCase())
      .filter(Boolean),
  );

export const PLACEMENT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const PLACEMENT_IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png', 'image/avif'] as const;

/**
 * Minimum creative dimensions.
 *
 * A 5:1 slot at 1200 px wide on a 2× screen wants 2400 px of source. Accepting a 600 px file means
 * an advertiser pays for a banner that renders blurry, notices, and blames the shop — so the floor is
 * enforced at upload rather than discovered in production.
 */
export const PLACEMENT_MIN_DESKTOP_WIDTH = 1600;
export const PLACEMENT_MIN_MOBILE_WIDTH = 750;

export const placementUploadSchema = z.object({
  contentType: z.enum(PLACEMENT_IMAGE_TYPES),
  size: z.coerce.number().int().positive().max(PLACEMENT_IMAGE_MAX_BYTES),
});

export const placementSchema = z
  .object({
    id: z.uuid().optional(),

    advertiserName: trimmed.min(2, 'Required.').max(120),
    internalNote: localized(500),

    headlineSq: localized(120),
    headlineEn: localized(120),
    subheadSq: localized(200),
    subheadEn: localized(200),
    ctaLabelSq: localized(40),
    ctaLabelEn: localized(40),

    /*
     * Absolute https or a site path. An advertiser's destination is legitimately off-site, so this
     * cannot be site-relative-only like the hero's — but `http://` would be blocked as mixed content
     * and `javascript:` is the reason this is a whitelist rather than a blacklist.
     */
    destinationUrl: trimmed
      .min(1, 'Required.')
      .max(500)
      .regex(/^(https:\/\/[^\s]+|\/(?!\/)[\w\-/?=&.%#]*)$/, 'Must be an https:// URL or a site path.'),
    openInNewTab: z.coerce.boolean().default(false),

    imageDesktopPath: localized(300),
    imageDesktopAltSq: localized(200),
    imageDesktopAltEn: localized(200),
    imageMobilePath: localized(300),
    imageMobileAltSq: localized(200),
    imageMobileAltEn: localized(200),

    isPaid: z.coerce.boolean().default(true),
    status: z.enum(['draft', 'pending_review', 'approved']).default('draft'),

    targetCategorySlugs: slugList,
    targetBrandSlugs: slugList,
    weight: z.coerce.number().int().min(1).max(100).default(1),

    startAt: trimmed.optional().or(z.literal('')),
    endAt: trimmed.optional().or(z.literal('')),
  })
  .superRefine((value, ctx) => {
    const has = (field: string | undefined) => Boolean(field?.trim());

    // Alt text arrives with the image, not with approval — the same rule the hero follows.
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

    /*
     * Approval is the gate, and it is where the requirements bite. Nothing merchant-supplied reaches
     * a shopper without a person having looked at the creative, the copy and the destination — which
     * is the whole point of the workflow, and the only place health claims get caught.
     */
    if (value.status !== 'approved') return;

    if (!has(value.imageDesktopPath)) {
      ctx.addIssue({
        code: 'custom',
        path: ['imageDesktopPath'],
        message: 'A desktop creative is required before approval.',
      });
    }
    // Copy is optional — most creatives carry their own message — but a half-translated one is not.
    for (const [sq, en, path] of [
      [value.headlineSq, value.headlineEn, 'headlineEn'],
      [value.ctaLabelSq, value.ctaLabelEn, 'ctaLabelEn'],
    ] as const) {
      if (has(sq) && !has(en)) {
        ctx.addIssue({ code: 'custom', path: [path], message: 'Both languages, or neither.' });
      }
      if (has(en) && !has(sq)) {
        ctx.addIssue({
          code: 'custom',
          path: [path.replace('En', 'Sq')],
          message: 'Both languages, or neither.',
        });
      }
    }
  });

export const placementIdSchema = z.object({ id: z.uuid() });

export const placementStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(['draft', 'pending_review', 'approved']),
});
