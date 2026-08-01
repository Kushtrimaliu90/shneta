import { describe, expect, it } from 'vitest';
import {
  buildRoutine,
  completeness,
  effectiveGoals,
  MAX_ROUTINE,
  MIN_ROUTINE,
  type Candidate,
} from '@/features/finder/scoring';
import type { FinderAnswers } from '@/features/finder/types';

/**
 * docs/05 §10 — the finder's scoring rules.
 *
 * Unit tests rather than an E2E walk-through, because the interesting properties are about the
 * *ranking*, and asserting a ranking through a browser means asserting the order of five cards
 * on a page — which passes for the wrong reasons the moment the layout changes. The rules are a
 * pure function; this is where they are checked.
 */

function candidate(overrides: Partial<Candidate> & { slug: string }): Candidate {
  return {
    productId: `00000000-0000-4000-8000-${overrides.slug.padStart(12, '0').slice(0, 12)}`,
    goalSlugs: [],
    dietaryTags: [],
    form: 'capsule',
    ratingAvg: 0,
    ratingCount: 0,
    inStock: true,
    priceCents: 1000,
    isFeatured: false,
    ...overrides,
  };
}

function answers(overrides: Partial<FinderAnswers> = {}): FinderAnswers {
  return {
    primary: 'gjumi',
    secondary: [],
    diet: 'none',
    sleep: 'ok',
    activity: 'moderate',
    require: [],
    form: 'any',
    budgetCents: null,
    ...overrides,
  };
}

describe('effectiveGoals', () => {
  it('turns a poor night into the sleep goal', () => {
    const result = effectiveGoals(answers({ primary: 'energji', sleep: 'poor' }));
    expect(result.secondary).toContain('gjumi');
  });

  it('never repeats the primary goal among the secondaries', () => {
    const result = effectiveGoals(answers({ primary: 'gjumi', secondary: ['gjumi'], sleep: 'poor' }));
    expect(result.primary).toBe('gjumi');
    expect(result.secondary).not.toContain('gjumi');
  });

  it('drops duplicates between the chosen and the implied', () => {
    const result = effectiveGoals(
      answers({ primary: 'stresi', secondary: ['gjumi'], sleep: 'poor' }),
    );
    expect(result.secondary.filter((slug) => slug === 'gjumi')).toHaveLength(1);
  });
});

describe('buildRoutine — the ranking rules', () => {
  it('puts a primary-goal match above a secondary-goal match', () => {
    const pool = [
      candidate({ slug: 'secondary', goalSlugs: ['imuniteti'] }),
      candidate({ slug: 'primary', goalSlugs: ['gjumi'] }),
    ];

    const { products } = buildRoutine(
      pool,
      answers({ primary: 'gjumi', secondary: ['imuniteti'] }),
    );

    expect(products[0]?.slug, '+3 must beat +1').toBe('primary');
  });

  it('does not let a rating outrank a goal match', () => {
    /*
     * The rule this protects: a five-star product that helps with nothing the customer asked
     * about must never appear above a modest product that does. The rating bonus is capped
     * below one secondary match precisely so this cannot happen.
     */
    const pool = [
      candidate({ slug: 'brilliant', goalSlugs: ['tretja'], ratingAvg: 5, ratingCount: 200 }),
      candidate({ slug: 'relevant', goalSlugs: ['gjumi'], ratingAvg: 3, ratingCount: 1 }),
    ];

    const { products } = buildRoutine(pool, answers({ primary: 'gjumi' }));

    expect(products[0]?.slug).toBe('relevant');
  });

  it('weighs a rating by how many people left one', () => {
    const pool = [
      candidate({ slug: 'one-review', goalSlugs: ['gjumi'], ratingAvg: 5, ratingCount: 1 }),
      candidate({ slug: 'forty-reviews', goalSlugs: ['gjumi'], ratingAvg: 4.5, ratingCount: 40 }),
    ];

    const { products } = buildRoutine(pool, answers({ primary: 'gjumi' }));

    expect(products[0]?.slug, 'a lone five-star review is not evidence').toBe('forty-reviews');
  });

  it('ranks identically on every call', () => {
    const pool = [
      candidate({ slug: 'b', goalSlugs: ['gjumi'] }),
      candidate({ slug: 'a', goalSlugs: ['gjumi'] }),
      candidate({ slug: 'c', goalSlugs: ['gjumi'] }),
    ];

    const first = buildRoutine(pool, answers()).products.map((p) => p.slug);
    const second = buildRoutine(pool, answers()).products.map((p) => p.slug);

    expect(first).toEqual(second);
    expect(first, 'equal scores fall back to the slug').toEqual(['a', 'b', 'c']);
  });
});

describe('buildRoutine — dietary constraints are constraints, not preferences', () => {
  it('never recommends a non-vegan product to a vegan', () => {
    const pool = [
      candidate({ slug: 'gelatin', goalSlugs: ['gjumi', 'stresi'], ratingAvg: 5, ratingCount: 99 }),
      candidate({ slug: 'plant', goalSlugs: ['gjumi'], dietaryTags: ['vegan'] }),
    ];

    const { products } = buildRoutine(pool, answers({ diet: 'vegan' }));

    expect(products.map((p) => p.slug)).not.toContain('gelatin');
  });

  it('accepts vegan products for a vegetarian', () => {
    const pool = [candidate({ slug: 'plant', goalSlugs: ['gjumi'], dietaryTags: ['vegan'] })];

    const { products } = buildRoutine(pool, answers({ diet: 'vegetarian' }));

    expect(products.map((p) => p.slug)).toContain('plant');
  });

  it('honours a required tag', () => {
    const pool = [
      candidate({ slug: 'wheat', goalSlugs: ['gjumi'] }),
      candidate({ slug: 'safe', goalSlugs: ['gjumi'], dietaryTags: ['gluten_free'] }),
    ];

    const { products } = buildRoutine(pool, answers({ require: ['gluten_free'] }));

    expect(products.map((p) => p.slug)).toEqual(['safe']);
  });

  it('keeps the constraint even when topping up a short routine', () => {
    /*
     * The dangerous case: too few matches, so the routine is padded from the pool. Padding must
     * still respect the diet — handing a vegan a gelatin capsule to reach three products would
     * be worse than returning two.
     */
    const pool = [
      candidate({ slug: 'plant', goalSlugs: ['gjumi'], dietaryTags: ['vegan'] }),
      candidate({ slug: 'gelatin-a', goalSlugs: ['tretja'] }),
      candidate({ slug: 'gelatin-b', goalSlugs: ['zemra'] }),
      candidate({ slug: 'gelatin-c', goalSlugs: ['kockat'] }),
    ];

    const { products } = buildRoutine(pool, answers({ diet: 'vegan' }));

    expect(products.every((p) => p.slug === 'plant')).toBe(true);
  });
});

describe('buildRoutine — the budget', () => {
  it('keeps the total under the budget', () => {
    const pool = [
      candidate({ slug: 'a', goalSlugs: ['gjumi'], priceCents: 2000 }),
      candidate({ slug: 'b', goalSlugs: ['gjumi'], priceCents: 2000 }),
      candidate({ slug: 'c', goalSlugs: ['gjumi'], priceCents: 2000 }),
    ];

    const { products } = buildRoutine(pool, answers({ budgetCents: 4500 }));
    const total = products.length * 2000;

    expect(total).toBeLessThanOrEqual(4500);
  });

  it('sacrifices the lowest-ranked product, never the best match', () => {
    const pool = [
      candidate({ slug: 'best', goalSlugs: ['gjumi'], priceCents: 3000 }),
      candidate({ slug: 'lesser', goalSlugs: ['imuniteti'], priceCents: 1000 }),
    ];

    const { products } = buildRoutine(
      pool,
      answers({ primary: 'gjumi', secondary: ['imuniteti'], budgetCents: 3000 }),
    );

    expect(products.map((p) => p.slug)).toEqual(['best']);
  });

  it('still returns something when the budget fits nothing', () => {
    const pool = [candidate({ slug: 'expensive', goalSlugs: ['gjumi'], priceCents: 9000 })];

    const { products } = buildRoutine(pool, answers({ budgetCents: 100 }));

    expect(products, 'an empty page explains nothing; the total does').toHaveLength(1);
  });
});

describe('buildRoutine — results are never empty (docs/05 §10 acceptance)', () => {
  it('falls back to the pool when nothing matches a goal', () => {
    const pool = [
      candidate({ slug: 'a', goalSlugs: ['tretja'], ratingAvg: 4, ratingCount: 10 }),
      candidate({ slug: 'b', goalSlugs: ['zemra'], ratingAvg: 5, ratingCount: 10 }),
      candidate({ slug: 'c', goalSlugs: ['kockat'], ratingAvg: 3, ratingCount: 10 }),
    ];

    const result = buildRoutine(pool, answers({ primary: 'floket' }));

    expect(result.products.length).toBeGreaterThan(0);
    expect(result.isFallback, 'and the page must say so').toBe(true);
  });

  it('does not claim a fallback when the goals were actually matched', () => {
    const pool = [
      candidate({ slug: 'a', goalSlugs: ['gjumi'] }),
      candidate({ slug: 'b', goalSlugs: ['gjumi'] }),
      candidate({ slug: 'c', goalSlugs: ['gjumi'] }),
    ];

    const result = buildRoutine(pool, answers());

    expect(result.isFallback).toBe(false);
    expect(result.products.length).toBeGreaterThanOrEqual(MIN_ROUTINE);
  });

  it('returns an empty routine only when the catalogue is empty', () => {
    const result = buildRoutine([], answers());
    expect(result.products).toHaveLength(0);
  });

  it('never returns more than the maximum', () => {
    const pool = Array.from({ length: 20 }, (_, index) =>
      candidate({ slug: `p${index}`, goalSlugs: ['gjumi'] }),
    );

    const { products } = buildRoutine(pool, answers());

    expect(products.length).toBeLessThanOrEqual(MAX_ROUTINE);
  });
});

describe('completeness', () => {
  it('is the share of goals covered, not the number of products', () => {
    const pool = [
      candidate({ slug: 'a', goalSlugs: ['gjumi'] }),
      candidate({ slug: 'b', goalSlugs: ['gjumi'] }),
      candidate({ slug: 'c', goalSlugs: ['gjumi'] }),
    ];

    const input = answers({ primary: 'gjumi', secondary: ['imuniteti'] });
    const { products } = buildRoutine(pool, input);

    // Three products, but only one of the two goals is covered.
    expect(completeness(products, input)).toBe(50);
  });

  it('is 100 when every goal is covered', () => {
    const pool = [
      candidate({ slug: 'a', goalSlugs: ['gjumi'] }),
      candidate({ slug: 'b', goalSlugs: ['imuniteti'] }),
    ];

    const input = answers({ primary: 'gjumi', secondary: ['imuniteti'] });
    const { products } = buildRoutine(pool, input);

    expect(completeness(products, input)).toBe(100);
  });

  it('is zero with no goals rather than dividing by zero', () => {
    expect(completeness([], answers({ primary: '', sleep: 'good', activity: 'low' }))).toBe(0);
  });
});
