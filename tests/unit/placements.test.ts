import { describe, expect, it } from 'vitest';
import { placementSchema } from '@/features/placements/admin-schemas';

/**
 * The rules that protect the shopper and the advertiser, rather than the ones that protect the form.
 *
 * Every one of these is also a check constraint in migration 76. Both layers matter: the constraint
 * makes the bad row impossible for any caller, and this makes the refusal land on the right field.
 */

function placement(overrides: Record<string, unknown> = {}) {
  return placementSchema.safeParse({
    advertiserName: 'Solgar',
    destinationUrl: 'https://solgar.example/campaign',
    imageDesktopPath: 'placements/abc.webp',
    imageDesktopAltSq: 'Reklamë Solgar',
    weight: '10',
    status: 'draft',
    ...overrides,
  });
}

function badFields(result: ReturnType<typeof placement>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('placement destinations', () => {
  it('accepts an advertiser https URL', () => {
    expect(placement().success).toBe(true);
  });

  it('accepts a site path, for own-brand promotions', () => {
    expect(placement({ destinationUrl: '/shop?category=proteina' }).success).toBe(true);
  });

  it('refuses http, which a browser would block as mixed content', () => {
    // The advertiser would be paying for a link nobody can follow.
    expect(badFields(placement({ destinationUrl: 'http://solgar.example' }))).toContain(
      'destinationUrl',
    );
  });

  it('refuses javascript: and protocol-relative URLs', () => {
    expect(badFields(placement({ destinationUrl: 'javascript:alert(1)' }))).toContain(
      'destinationUrl',
    );
    expect(badFields(placement({ destinationUrl: '//evil.example' }))).toContain('destinationUrl');
  });
});

describe('approval is the gate', () => {
  it('lets a draft be incomplete', () => {
    expect(placement({ status: 'draft', imageDesktopPath: '', imageDesktopAltSq: '' }).success).toBe(
      true,
    );
  });

  it('refuses approval with no creative', () => {
    /*
     * An approved placement with nothing to show is a reserved empty box on a shop page, which the
     * brief forbids outright.
     */
    const result = placement({ status: 'approved', imageDesktopPath: '', imageDesktopAltSq: '' });
    expect(badFields(result)).toContain('imageDesktopPath');
  });

  it('refuses a half-translated headline at approval', () => {
    // Albanian is the default locale; an English-only headline renders blank on /en.
    expect(badFields(placement({ status: 'approved', headlineEn: 'Save 20%' }))).toContain(
      'headlineSq',
    );
    expect(badFields(placement({ status: 'approved', headlineSq: 'Kurse 20%' }))).toContain(
      'headlineEn',
    );
  });

  it('allows no copy at all — most creatives carry their own message', () => {
    expect(placement({ status: 'approved' }).success).toBe(true);
  });
});

describe('alt text', () => {
  it('is required as soon as there is a creative, draft or not', () => {
    expect(badFields(placement({ imageDesktopAltSq: '' }))).toContain('imageDesktopAltSq');
  });

  it('is required on the mobile creative too', () => {
    expect(badFields(placement({ imageMobilePath: 'placements/m.webp' }))).toContain(
      'imageMobileAltSq',
    );
  });
});

describe('targeting and weight', () => {
  it('parses a comma-separated slug list, lower-cased', () => {
    const result = placement({ targetCategorySlugs: 'Sports-Nutrition, proteina ' });
    expect(result.success && result.data.targetCategorySlugs).toEqual([
      'sports-nutrition',
      'proteina',
    ]);
  });

  it('treats an empty target as every listing page', () => {
    const result = placement({ targetCategorySlugs: '', targetBrandSlugs: '' });
    expect(result.success && result.data.targetCategorySlugs).toEqual([]);
    expect(result.success && result.data.targetBrandSlugs).toEqual([]);
  });

  it('holds weight inside 1–100', () => {
    expect(placement({ weight: '0' }).success).toBe(false);
    expect(placement({ weight: '101' }).success).toBe(false);
    expect(placement({ weight: '100' }).success).toBe(true);
  });

  it('refuses an end date at or before the start', () => {
    const result = placement({ startAt: '2026-09-01T10:00', endAt: '2026-09-01T09:00' });
    expect(badFields(result)).toContain('endAt');
  });
});

describe('disclosure', () => {
  it('defaults to paid, so a placement cannot become undisclosed by omission', () => {
    /*
     * `isPaid` drives the Sponsored label and there is no separate control to suppress it. Defaulting
     * to *true* means an operator who forgets the checkbox over-discloses rather than under-discloses,
     * which is the only safe direction for this particular default.
     */
    const result = placement();
    expect(result.success && result.data.isPaid).toBe(true);
  });

  it('lets an own-brand promotion opt out of the label explicitly', () => {
    const result = placement({ isPaid: '' });
    expect(result.success && result.data.isPaid).toBe(false);
  });
});
