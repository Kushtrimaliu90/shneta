import { z } from 'zod';

/**
 * docs/02 §7 — every mutation validates against a schema from its feature's `schemas.ts`.
 *
 * The shapes here mirror the SQL constraints rather than merely coexisting with them. A `pin` needs a
 * position, a `boost` needs a positive weight, a `bury` needs a negative one, and `match_type = 'any'`
 * means no query — all four are `check` constraints in migration 66, and duplicating them here is what
 * turns a database error into a field-level message an operator can act on.
 */

const trimmed = z.string().trim();

/** Terms are entered one per line, which is the only sane way to type twenty of them. */
export const synonymGroupSchema = z.object({
  id: z.uuid().optional(),
  label: trimmed.min(2).max(60),
  terms: trimmed
    .min(1)
    .transform((value) =>
      value
        .split(/[\n,]/)
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean),
    )
    .refine((terms) => terms.length >= 2, { message: 'A group needs at least two terms.' })
    .refine((terms) => terms.length <= 40, { message: 'Forty terms is the limit.' })
    .refine((terms) => new Set(terms).size === terms.length, { message: 'Terms must be unique.' }),
  note: trimmed.max(300).optional().or(z.literal('')),
  isActive: z.coerce.boolean().default(true),
});

export const searchRuleSchema = z
  .object({
    action: z.enum(['pin', 'boost', 'bury', 'hide']),
    productId: z.uuid(),
    matchType: z.enum(['exact', 'contains', 'any']),
    query: trimmed.max(120).optional().or(z.literal('')),
    pinPosition: z.coerce.number().int().min(1).max(100).optional(),
    weight: z.coerce.number().min(-99).max(99).optional(),
    note: trimmed.max(300).optional().or(z.literal('')),
  })
  .superRefine((value, ctx) => {
    const hasQuery = Boolean(value.query?.trim());

    if (value.matchType === 'any' && hasQuery) {
      ctx.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'Leave the query empty for “any”.',
      });
    }
    if (value.matchType !== 'any' && !hasQuery) {
      ctx.addIssue({ code: 'custom', path: ['query'], message: 'A query is required.' });
    }
    if (value.action === 'pin' && value.pinPosition == null) {
      ctx.addIssue({ code: 'custom', path: ['pinPosition'], message: 'A pin needs a position.' });
    }
    if (value.action === 'boost' && !(value.weight && value.weight > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['weight'],
        message: 'A boost needs a positive weight.',
      });
    }
    if (value.action === 'bury' && !(value.weight && value.weight < 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['weight'],
        message: 'A bury needs a negative weight.',
      });
    }
  });

export const searchRedirectSchema = z.object({
  query: trimmed.min(2).max(120),
  matchType: z.enum(['exact', 'contains']),
  // Site-relative and unlocalised. An absolute URL here would be an open redirect from a text box
  // three staff roles can edit; the leading slash is the whole defence and it belongs in both layers.
  destinationPath: trimmed
    .min(1)
    .max(200)
    .regex(/^\/(?!\/)[\w\-/?=&.%]*$/, 'Must be a site path beginning with a single “/”.'),
  note: trimmed.max(300).optional().or(z.literal('')),
});

export const idSchema = z.object({ id: z.uuid() });
