import { describe, expect, it } from 'vitest';
import { generateProtocol } from '@/features/biohack/engine';
import type {
  CatalogProduct,
  ProtocolBlock,
  ProtocolConfig,
  ProtocolConflict,
  ProtocolInputs,
} from '@/features/biohack/types';

/**
 * docs/15 §7 — the engine's rules, as cases.
 *
 * These matter more than usual. A recommendation engine is the one part of the shop whose output
 * nobody can eyeball for correctness: a plausible-looking stack of five supplements is
 * indistinguishable from a correct one, so "it looked right in the browser" proves nothing. The
 * rules are only real if they are asserted here.
 *
 * Every fixture is hand-written rather than loaded, because the engine is pure — that is the
 * whole point of it being pure.
 */

function block(over: Partial<ProtocolBlock> & { goalSlug: string }): ProtocolBlock {
  const slug = over.ingredientSlug ?? null;
  return {
    id: `b-${over.goalSlug}-${slug ?? 'habit'}`,
    ingredientSlug: slug,
    ingredientName: slug ? { sq: slug, en: slug } : null,
    habit: null,
    weight: 50,
    isCore: false,
    timing: ['mengjes'],
    phase: 1,
    why: { sq: 'sepse', en: 'because' },
    evidence: null,
    caution: null,
    active: true,
    medSensitive: false,
    containsCaffeine: false,
    ...over,
  };
}

function product(over: Partial<CatalogProduct> & { slug: string }): CatalogProduct {
  return {
    productId: `p-${over.slug}`,
    variantId: `v-${over.slug}`,
    ingredientSlugs: [],
    dietaryTags: [],
    priceCents: 1000,
    pricePerServingCents: 30,
    ratingAvg: 4,
    isFeatured: false,
    inStock: true,
    ...over,
  };
}

function config(over: Partial<ProtocolConfig> = {}): ProtocolConfig {
  return {
    version: 1,
    blocks: [],
    conflicts: [],
    profileRules: [],
    metrics: {},
    settings: {
      maxItems: 5,
      minItems: 2,
      maxGoals: 3,
      perGoalCoreGuarantee: true,
      durationDays: 28,
      budgetTiers: [2000, 4000],
      subscriptionConvert: true,
    },
    ...over,
  };
}

function answers(over: Partial<ProtocolInputs> = {}): ProtocolInputs {
  return {
    goals: ['gjumi'],
    diet: 'pa_kufizime',
    caffeine: 'po',
    restrictedLifeStage: false,
    medication: false,
    level: 'i_avancuar',
    budgetCents: null,
    ...over,
  };
}

const keys = (result: { items: { key: string }[] }): string[] => result.items.map((i) => i.key);

// ── The gate ─────────────────────────────────────────────────────────────────

describe('the hard gate (docs/15 §1 step 2, §6)', () => {
  it('returns gated with no items for pregnancy, nursing or under 18', () => {
    const c = config({ blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'magnez' })] });
    const result = generateProtocol(
      c,
      [product({ slug: 'm', ingredientSlugs: ['magnez'] })],
      answers({ restrictedLifeStage: true }),
    );

    expect(result.gated).toBe(true);
    expect(result.items).toHaveLength(0);
  });

  it('gates before anything else, so no product is even resolved', () => {
    const c = config({ blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'magnez' })] });
    const result = generateProtocol(c, [], answers({ restrictedLifeStage: true }));

    expect(result.monthlyTotalCents).toBe(0);
    expect(result.trace.some((t) => t.subject === 'restricted_life_stage')).toBe(true);
  });
});

// ── Synergy ──────────────────────────────────────────────────────────────────

describe('synergy scoring (docs/15 §3.3)', () => {
  it('sums the weights of every chosen goal an ingredient serves', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'magnez', weight: 90 }),
        block({ goalSlug: 'stresi', ingredientSlug: 'magnez', weight: 75 }),
      ],
    });
    const result = generateProtocol(
      c,
      [product({ slug: 'm', ingredientSlugs: ['magnez'] })],
      answers({ goals: ['gjumi', 'stresi'] }),
    );

    expect(result.items[0]?.score).toBe(165);
  });

  it('lists both goals on the item, which is what the PSE line names', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'magnez', weight: 90 }),
        block({ goalSlug: 'stresi', ingredientSlug: 'magnez', weight: 75 }),
      ],
    });
    const result = generateProtocol(
      c,
      [product({ slug: 'm', ingredientSlugs: ['magnez'] })],
      answers({ goals: ['gjumi', 'stresi'] }),
    );

    expect(result.items[0]?.goalSlugs.sort()).toEqual(['gjumi', 'stresi']);
  });

  it('an ingredient serving two goals outranks a heavier one serving only one', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'both', weight: 60 }),
        block({ goalSlug: 'stresi', ingredientSlug: 'both', weight: 60 }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'single', weight: 95 }),
      ],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'a', ingredientSlugs: ['both'] }),
        product({ slug: 'b', ingredientSlugs: ['single'] }),
      ],
      answers({ goals: ['gjumi', 'stresi'] }),
    );

    expect(keys(result)[0]).toBe('both');
  });

  it('the earliest phase wins when an ingredient is core for one goal and optional for another', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'magnez', phase: 1 }),
        block({ goalSlug: 'stresi', ingredientSlug: 'magnez', phase: 2 }),
      ],
    });
    const result = generateProtocol(
      c,
      [product({ slug: 'm', ingredientSlugs: ['magnez'] })],
      answers({ goals: ['gjumi', 'stresi'], level: 'fillestar' }),
    );

    expect(result.items[0]?.phase).toBe(1);
  });
});

// ── Filters ──────────────────────────────────────────────────────────────────

describe('medication and caffeine filters (docs/15 §3.4)', () => {
  it('drops med_sensitive ingredients outright when the customer takes medication', () => {
    const c = config({
      blocks: [
        block({
          goalSlug: 'stresi',
          ingredientSlug: 'ashwagandha',
          medSensitive: true,
          weight: 90,
        }),
        block({ goalSlug: 'stresi', ingredientSlug: 'magnez', weight: 70 }),
      ],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'a', ingredientSlugs: ['ashwagandha'] }),
        product({ slug: 'm', ingredientSlugs: ['magnez'] }),
      ],
      answers({ goals: ['stresi'], medication: true }),
    );

    expect(keys(result)).not.toContain('ashwagandha');
    expect(keys(result)).toContain('magnez');
  });

  it('sets medicationCaution so the result page can carry a standing banner', () => {
    const c = config({ blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'magnez' })] });
    const result = generateProtocol(
      c,
      [product({ slug: 'm', ingredientSlugs: ['magnez'] })],
      answers({ medication: true }),
    );

    expect(result.medicationCaution).toBe(true);
  });

  it('drops caffeine ingredients entirely on "jo"', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'truri', ingredientSlug: 'kafeine', containsCaffeine: true, weight: 90 }),
        block({ goalSlug: 'truri', ingredientSlug: 'omega3', weight: 60 }),
      ],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'k', ingredientSlugs: ['kafeine'] }),
        product({ slug: 'o', ingredientSlugs: ['omega3'] }),
      ],
      answers({ goals: ['truri'], caffeine: 'jo' }),
    );

    expect(keys(result)).toEqual(['omega3']);
  });

  it('"vetëm në mëngjes" keeps caffeine but confines it to a morning slot', () => {
    const c = config({
      blocks: [
        block({
          goalSlug: 'truri',
          ingredientSlug: 'kafeine',
          containsCaffeine: true,
          timing: ['mengjes', 'dite'],
        }),
      ],
    });
    const result = generateProtocol(
      c,
      [product({ slug: 'k', ingredientSlugs: ['kafeine'] })],
      answers({ goals: ['truri'], caffeine: 'vetem_mengjes' }),
    );

    expect(result.items[0]?.timing).toEqual(['mengjes']);
  });

  it('"vetëm në mëngjes" composes with a timing rule that already narrowed the slots', () => {
    const c = config({
      blocks: [
        block({
          goalSlug: 'truri',
          ingredientSlug: 'kafeine',
          containsCaffeine: true,
          timing: ['mengjes', 'dite', 'mbremje'],
        }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'magnez' }),
      ],
      conflicts: [
        conflict({
          aIngredientSlug: 'kafeine',
          bGoalSlug: 'gjumi',
          kind: 'timing_rule',
          rule: { allowedSlots: ['mengjes', 'dite'] },
        }),
      ],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'k', ingredientSlugs: ['kafeine'] }),
        product({ slug: 'm', ingredientSlugs: ['magnez'] }),
      ],
      answers({ goals: ['truri', 'gjumi'], caffeine: 'vetem_mengjes' }),
    );

    const caffeine = result.items.find((i) => i.key === 'kafeine');
    expect(
      caffeine?.timing,
      'the rule narrowed to morning+day, then the answer to morning',
    ).toEqual(['mengjes']);
  });
});

function conflict(over: Partial<ProtocolConflict>): ProtocolConflict {
  return {
    id: over.id ?? `c-${over.aIngredientSlug}-${over.bGoalSlug ?? over.bIngredientSlug}`,
    aIngredientSlug: null,
    bIngredientSlug: null,
    bGoalSlug: null,
    kind: 'caution',
    rule: {},
    note: null,
    ...over,
  };
}

// ── Conflicts ────────────────────────────────────────────────────────────────

describe('the conflict matrix (docs/15 §3.5)', () => {
  it('exclude drops the lower-scored side and records why', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'melatonin', weight: 40 }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'magnez', weight: 90 }),
      ],
      conflicts: [
        conflict({ aIngredientSlug: 'melatonin', bIngredientSlug: 'magnez', kind: 'exclude' }),
      ],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'mel', ingredientSlugs: ['melatonin'] }),
        product({ slug: 'mag', ingredientSlugs: ['magnez'] }),
      ],
      answers(),
    );

    expect(keys(result)).toEqual(['magnez']);
    expect(
      result.trace.some((t) => t.kind === 'excluded_conflict' && t.subject === 'melatonin'),
    ).toBe(true);
  });

  it('exclude against a chosen goal removes the ingredient', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'truri', ingredientSlug: 'kafeine', weight: 90 }),
        block({ goalSlug: 'truri', ingredientSlug: 'omega3', weight: 50 }),
      ],
      conflicts: [conflict({ aIngredientSlug: 'kafeine', bGoalSlug: 'gjumi', kind: 'exclude' })],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'k', ingredientSlugs: ['kafeine'] }),
        product({ slug: 'o', ingredientSlugs: ['omega3'] }),
      ],
      answers({ goals: ['truri', 'gjumi'] }),
    );

    expect(keys(result)).not.toContain('kafeine');
  });

  it('a goal conflict that the customer did not choose does not fire', () => {
    const c = config({
      blocks: [block({ goalSlug: 'truri', ingredientSlug: 'kafeine', weight: 90 })],
      conflicts: [conflict({ aIngredientSlug: 'kafeine', bGoalSlug: 'gjumi', kind: 'exclude' })],
    });
    const result = generateProtocol(
      c,
      [product({ slug: 'k', ingredientSlugs: ['kafeine'] })],
      answers({ goals: ['truri'] }),
    );

    expect(keys(result)).toEqual(['kafeine']);
  });

  it('timing_rule constrains the slots rather than dropping the item', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'truri', ingredientSlug: 'kafeine', timing: ['mengjes', 'mbremje'] }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'magnez' }),
      ],
      conflicts: [
        conflict({
          aIngredientSlug: 'kafeine',
          bGoalSlug: 'gjumi',
          kind: 'timing_rule',
          rule: { allowedSlots: ['mengjes'] },
        }),
      ],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'k', ingredientSlugs: ['kafeine'] }),
        product({ slug: 'm', ingredientSlugs: ['magnez'] }),
      ],
      answers({ goals: ['truri', 'gjumi'] }),
    );

    expect(result.items.find((i) => i.key === 'kafeine')?.timing).toEqual(['mengjes']);
  });

  it('caution attaches a note without removing anything', () => {
    const note = { sq: 'kujdes', en: 'caution' };
    const c = config({
      blocks: [block({ goalSlug: 'imuniteti', ingredientSlug: 'zink' })],
      conflicts: [
        conflict({ aIngredientSlug: 'zink', bGoalSlug: 'imuniteti', kind: 'caution', note }),
      ],
    });
    const result = generateProtocol(
      c,
      [product({ slug: 'z', ingredientSlugs: ['zink'] })],
      answers({ goals: ['imuniteti'] }),
    );

    expect(result.items[0]?.caution).toEqual(note);
  });

  it('an excluded ingredient does not also pick up a caution', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'melatonin', weight: 30 }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'magnez', weight: 90 }),
      ],
      conflicts: [
        conflict({
          id: 'a',
          aIngredientSlug: 'melatonin',
          bIngredientSlug: 'magnez',
          kind: 'exclude',
        }),
        conflict({
          id: 'b',
          aIngredientSlug: 'melatonin',
          bGoalSlug: 'gjumi',
          kind: 'caution',
          note: { sq: 'x', en: 'x' },
        }),
      ],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'mel', ingredientSlugs: ['melatonin'] }),
        product({ slug: 'mag', ingredientSlugs: ['magnez'] }),
      ],
      answers(),
    );

    expect(
      result.trace.some((t) => t.kind === 'caution_attached' && t.subject === 'melatonin'),
    ).toBe(false);
  });
});

// ── Selection, caps and the core guarantee ───────────────────────────────────

describe('selection (docs/15 §3.6)', () => {
  it('guarantees at least one item per chosen goal even when another goal dominates', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'energji', ingredientSlug: 'b12', weight: 95, isCore: true }),
        block({ goalSlug: 'energji', ingredientSlug: 'd3', weight: 92 }),
        block({ goalSlug: 'energji', ingredientSlug: 'fer', weight: 90 }),
        block({ goalSlug: 'energji', ingredientSlug: 'koenzima', weight: 88 }),
        block({ goalSlug: 'energji', ingredientSlug: 'rodiola', weight: 86 }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'magnez', weight: 20, isCore: true }),
      ],
      settings: { ...config().settings, maxItems: 3 },
    });
    const result = generateProtocol(
      c,
      ['b12', 'd3', 'fer', 'koenzima', 'rodiola', 'magnez'].map((s) =>
        product({ slug: s, ingredientSlugs: [s] }),
      ),
      answers({ goals: ['energji', 'gjumi'] }),
    );

    expect(keys(result), 'sleep must be represented despite scoring lowest').toContain('magnez');
  });

  it('prefers a core block over a heavier non-core one for the guarantee', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'heavy', weight: 90 }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'core', weight: 40, isCore: true }),
      ],
      settings: { ...config().settings, maxItems: 1 },
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'heavy', ingredientSlugs: ['heavy'] }),
        product({ slug: 'core', ingredientSlugs: ['core'] }),
      ],
      answers(),
    );

    expect(keys(result)).toEqual(['core']);
  });

  it('never returns more than maxItems', () => {
    const c = config({
      blocks: Array.from({ length: 12 }, (_, i) =>
        block({ goalSlug: 'gjumi', ingredientSlug: `x${i}`, weight: 50 + i }),
      ),
    });
    const result = generateProtocol(
      c,
      Array.from({ length: 12 }, (_, i) => product({ slug: `x${i}`, ingredientSlugs: [`x${i}`] })),
      answers(),
    );

    expect(result.items.length).toBeLessThanOrEqual(5);
  });

  it('caps the goals at maxGoals rather than trusting the caller', () => {
    const c = config({
      blocks: ['a', 'b', 'c', 'd'].map((g) => block({ goalSlug: g, ingredientSlug: `i-${g}` })),
    });
    const result = generateProtocol(
      c,
      ['a', 'b', 'c', 'd'].map((g) => product({ slug: `i-${g}`, ingredientSlugs: [`i-${g}`] })),
      answers({ goals: ['a', 'b', 'c', 'd'] }),
    );

    expect(result.goalSlugs).toEqual(['a', 'b', 'c']);
    expect(keys(result)).not.toContain('i-d');
  });

  it('ignores inactive blocks', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'off', weight: 99, active: false }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'on', weight: 10 }),
      ],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'off', ingredientSlugs: ['off'] }),
        product({ slug: 'on', ingredientSlugs: ['on'] }),
      ],
      answers(),
    );

    expect(keys(result)).toEqual(['on']);
  });
});

// ── Budget ───────────────────────────────────────────────────────────────────

describe('the budget (docs/15 §3.6)', () => {
  it('keeps the total under the tier', () => {
    const c = config({
      blocks: ['a', 'b', 'c'].map((s) =>
        block({ goalSlug: 'gjumi', ingredientSlug: s, weight: 50 }),
      ),
    });
    const result = generateProtocol(
      c,
      ['a', 'b', 'c'].map((s) => product({ slug: s, ingredientSlugs: [s], priceCents: 1500 })),
      answers({ budgetCents: 4000 }),
    );

    expect(result.monthlyTotalCents).toBeLessThanOrEqual(4000);
  });

  it('never drops the last item representing a goal, even over budget', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'sleep', weight: 90, isCore: true }),
        block({ goalSlug: 'stresi', ingredientSlug: 'stress', weight: 10, isCore: true }),
      ],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'sleep', ingredientSlugs: ['sleep'], priceCents: 3900 }),
        product({ slug: 'stress', ingredientSlugs: ['stress'], priceCents: 3900 }),
      ],
      answers({ goals: ['gjumi', 'stresi'], budgetCents: 4000 }),
    );

    expect(keys(result).sort(), 'both goals keep representation').toEqual(['sleep', 'stress']);
    expect(result.trace.some((t) => t.detail === 'over_budget')).toBe(true);
  });

  it('habits are free and survive any budget', () => {
    const c = config({
      blocks: [
        block({
          goalSlug: 'gjumi',
          ingredientSlug: null,
          habit: { sq: 'pa ekrane', en: 'no screens' },
          weight: 80,
          isCore: true,
        }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'pricey', weight: 90 }),
      ],
    });
    const result = generateProtocol(
      c,
      [product({ slug: 'pricey', ingredientSlugs: ['pricey'], priceCents: 9000 })],
      answers({ budgetCents: 1000 }),
    );

    expect(keys(result).some((k) => k.startsWith('habit:'))).toBe(true);
  });

  /**
   * docs/15 §0 — ported from the Finder, which bought this rule with a real bug (docs/13 §P7).
   *
   * The first Finder trimmed the routine to fit the budget and then topped it back up to the
   * minimum item count, quietly undoing the trim: the customer set a limit, the code respected it
   * for one statement, and the result came back over it anyway.
   *
   * The engine may still exceed a budget — the per-goal guarantee outranks it, and a protocol
   * below `min_items` is not a protocol — but only *deliberately*, and only in ways the trace
   * records. This asserts the shape of that: what comes back over budget is there because a rule
   * put it there, and there is a trace entry naming the rule.
   */
  it('never exceeds the budget silently: an over-budget item is always explained', () => {
    const c = config({
      blocks: ['a', 'b', 'c', 'd'].map((s) =>
        block({ goalSlug: 'gjumi', ingredientSlug: s, weight: 50 }),
      ),
    });
    const result = generateProtocol(
      c,
      ['a', 'b', 'c', 'd'].map((s) => product({ slug: s, ingredientSlugs: [s], priceCents: 3000 })),
      answers({ budgetCents: 4000 }),
    );

    if (result.monthlyTotalCents > 4000) {
      const explained = result.trace.some(
        (entry) => entry.detail === 'over_budget' || entry.kind === 'budget_cut',
      );
      expect(explained, 'over budget without a trace entry is the §P7 bug').toBe(true);
    }

    // And the cut itself is recorded rather than the items simply vanishing.
    expect(result.trace.some((entry) => entry.kind === 'budget_cut')).toBe(true);
  });

  /**
   * The Finder's other hard-won rule (docs/05 §10 acceptance, docs/15 §0): a result is never
   * empty, and a degenerate one says so rather than passing itself off as a match.
   *
   * Here the whole catalogue is out of stock. The engine still returns the ingredients — they are
   * the right answer — but marks every one "së shpejti", keeps them out of the total, and puts
   * the reason in the trace. An empty page would tell the customer nothing; a page of unbuyable
   * items presented as buyable would be worse.
   */
  it('nothing in stock still returns a protocol, marked and costed at zero', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'a', weight: 90, isCore: true }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'b', weight: 60 }),
      ],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'a', ingredientSlugs: ['a'], inStock: false }),
        product({ slug: 'b', ingredientSlugs: ['b'], inStock: false }),
      ],
      answers(),
    );

    expect(result.items.length, 'never empty').toBeGreaterThan(0);
    expect(result.items.every((item) => item.comingSoon)).toBe(true);
    expect(result.items.every((item) => item.product === null)).toBe(true);
    expect(result.monthlyTotalCents, 'unbuyable items cost nothing').toBe(0);
    expect(result.trace.filter((entry) => entry.kind === 'no_stock')).toHaveLength(2);
  });

  it('a budget of null is no limit, not zero', () => {
    const c = config({
      blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'x', weight: 50 })],
    });
    const result = generateProtocol(
      c,
      [product({ slug: 'x', ingredientSlugs: ['x'], priceCents: 12000 })],
      answers({ budgetCents: null }),
    );

    expect(keys(result)).toEqual(['x']);
  });
});

// ── Product resolution ───────────────────────────────────────────────────────

describe('product resolution (docs/15 §3.8)', () => {
  it('ranks featured, then rating, then price per serving', () => {
    const c = config({ blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'magnez' })] });
    const result = generateProtocol(
      c,
      [
        product({
          slug: 'cheap',
          ingredientSlugs: ['magnez'],
          ratingAvg: 3,
          pricePerServingCents: 10,
        }),
        product({
          slug: 'featured',
          ingredientSlugs: ['magnez'],
          ratingAvg: 3,
          isFeatured: true,
          pricePerServingCents: 40,
        }),
        product({
          slug: 'rated',
          ingredientSlugs: ['magnez'],
          ratingAvg: 5,
          pricePerServingCents: 30,
        }),
      ],
      answers(),
    );

    expect(result.items[0]?.product?.slug).toBe('featured');
  });

  it('prefers price per serving over sticker price', () => {
    const c = config({ blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'magnez' })] });
    const result = generateProtocol(
      c,
      [
        product({
          slug: 'small-box',
          ingredientSlugs: ['magnez'],
          priceCents: 900,
          pricePerServingCents: 30,
        }),
        product({
          slug: 'big-tub',
          ingredientSlugs: ['magnez'],
          priceCents: 2200,
          pricePerServingCents: 18,
        }),
      ],
      answers(),
    );

    expect(result.items[0]?.product?.slug).toBe('big-tub');
  });

  it('a vegan gets only vegan-tagged products', () => {
    const c = config({ blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'magnez' })] });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'gelatin', ingredientSlugs: ['magnez'], isFeatured: true }),
        product({ slug: 'plant', ingredientSlugs: ['magnez'], dietaryTags: ['vegan'] }),
      ],
      answers({ diet: 'vegan' }),
    );

    expect(result.items[0]?.product?.slug).toBe('plant');
  });

  it('vegetarian accepts vegan products too', () => {
    const c = config({ blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'magnez' })] });
    const result = generateProtocol(
      c,
      [product({ slug: 'plant', ingredientSlugs: ['magnez'], dietaryTags: ['vegan'] })],
      answers({ diet: 'vegjetarian' }),
    );

    expect(result.items[0]?.product?.slug).toBe('plant');
  });

  it('an ingredient with no compliant product becomes "coming soon", not a wrong product', () => {
    const c = config({ blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'magnez' })] });
    const result = generateProtocol(
      c,
      [product({ slug: 'gelatin', ingredientSlugs: ['magnez'] })],
      answers({ diet: 'vegan' }),
    );

    expect(result.items[0]?.comingSoon).toBe(true);
    expect(result.items[0]?.product).toBeNull();
  });

  it('out of stock becomes "coming soon" and is excluded from the total', () => {
    const c = config({ blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'magnez' })] });
    const result = generateProtocol(
      c,
      [product({ slug: 'm', ingredientSlugs: ['magnez'], inStock: false, priceCents: 5000 })],
      answers(),
    );

    expect(result.items[0]?.comingSoon).toBe(true);
    expect(result.monthlyTotalCents).toBe(0);
  });

  it('habits never resolve to a product', () => {
    const c = config({
      blocks: [
        block({
          goalSlug: 'gjumi',
          ingredientSlug: null,
          habit: { sq: 'dritë dielli', en: 'daylight' },
        }),
      ],
    });
    const result = generateProtocol(c, [], answers());

    expect(result.items[0]?.kind).toBe('habit');
    expect(result.items[0]?.product).toBeNull();
  });
});

// ── Phasing ──────────────────────────────────────────────────────────────────

describe('phasing (docs/15 §3.7)', () => {
  it('a beginner keeps phase 2 deferred and the result is marked phased', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'a', weight: 90, phase: 1 }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'b', weight: 80, phase: 2 }),
      ],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'a', ingredientSlugs: ['a'] }),
        product({ slug: 'b', ingredientSlugs: ['b'] }),
      ],
      answers({ level: 'fillestar' }),
    );

    expect(result.phased).toBe(true);
    expect(result.items.find((i) => i.key === 'b')?.phase).toBe(2);
  });

  it('an advanced customer starts everything on day one', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'a', weight: 90, phase: 1 }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'b', weight: 80, phase: 2 }),
      ],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'a', ingredientSlugs: ['a'] }),
        product({ slug: 'b', ingredientSlugs: ['b'] }),
      ],
      answers({ level: 'i_avancuar' }),
    );

    expect(result.phased).toBe(false);
    expect(result.items.every((i) => i.phase === 1)).toBe(true);
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────

describe('determinism (docs/15 §3)', () => {
  it('is byte-identical across repeated runs', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'a', weight: 50 }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'b', weight: 50 }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'c', weight: 50 }),
      ],
    });
    const catalog = ['a', 'b', 'c'].map((s) => product({ slug: s, ingredientSlugs: [s] }));

    const first = generateProtocol(c, catalog, answers());
    const second = generateProtocol(c, catalog, answers());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('equal scores break by key, not by input order', () => {
    const forwards = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'zebra', weight: 50 }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'alpha', weight: 50 }),
      ],
    });
    const backwards = config({ blocks: [...forwards.blocks].reverse() });
    const catalog = ['zebra', 'alpha'].map((s) => product({ slug: s, ingredientSlugs: [s] }));

    expect(keys(generateProtocol(forwards, catalog, answers()))).toEqual(['alpha', 'zebra']);
    expect(keys(generateProtocol(backwards, catalog, answers()))).toEqual(['alpha', 'zebra']);
  });

  /**
   * The case that isolates the **final** tiebreak rather than an earlier one.
   *
   * Written after a mutation test: deleting `bestFirst`'s `localeCompare` left the suite green,
   * because the candidate list is already built in key order by `byBlockOrder` and V8's sort is
   * stable. So the test above proves the pipeline is deterministic without proving that line does
   * anything.
   *
   * Here `zulu` scores 100 from one heavy block and `alpha` scores 100 from two light ones, so
   * `byBlockOrder` inserts zulu first — and only the final tiebreak can put alpha ahead of it.
   */
  it('breaks a tie between equal totals assembled from different weights', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'zulu', weight: 100 }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'alpha', weight: 60 }),
        block({ goalSlug: 'stresi', ingredientSlug: 'alpha', weight: 40 }),
      ],
      settings: { ...config().settings, perGoalCoreGuarantee: false },
    });
    const catalog = ['zulu', 'alpha'].map((s) => product({ slug: s, ingredientSlugs: [s] }));

    const result = generateProtocol(c, catalog, answers({ goals: ['gjumi', 'stresi'] }));

    expect(result.items[0]?.score, 'both reach 100').toBe(100);
    expect(result.items[1]?.score).toBe(100);
    expect(keys(result), 'the tie resolves by key, so alpha leads').toEqual(['alpha', 'zulu']);
  });
});

// ── Metrics and degenerate cases ─────────────────────────────────────────────

describe('metrics and empty results (docs/15 §1, §6)', () => {
  it('unions the metric templates of the chosen goals, deduplicated', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'a' }),
        block({ goalSlug: 'stresi', ingredientSlug: 'b' }),
      ],
      metrics: {
        gjumi: { sq: ['Cilësia e gjumit', 'Energjia'], en: ['Sleep quality', 'Energy'] },
        stresi: { sq: ['Energjia', 'Stresi'], en: ['Energy', 'Stress'] },
      },
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'a', ingredientSlugs: ['a'] }),
        product({ slug: 'b', ingredientSlugs: ['b'] }),
      ],
      answers({ goals: ['gjumi', 'stresi'] }),
    );

    expect(result.metrics.sq).toEqual(['Cilësia e gjumit', 'Energjia', 'Stresi']);
  });

  it('returns an empty, ungated protocol when the config has nothing for the goal', () => {
    const result = generateProtocol(config(), [], answers({ goals: ['floket'] }));

    expect(result.gated).toBe(false);
    expect(result.items).toHaveLength(0);
  });

  it('still returns the surviving subset when filters remove most of it', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'stresi', ingredientSlug: 'ash', medSensitive: true, weight: 90 }),
        block({ goalSlug: 'stresi', ingredientSlug: 'mag', weight: 40 }),
      ],
    });
    const result = generateProtocol(
      c,
      [
        product({ slug: 'ash', ingredientSlugs: ['ash'] }),
        product({ slug: 'mag', ingredientSlugs: ['mag'] }),
      ],
      answers({ goals: ['stresi'], medication: true }),
    );

    expect(keys(result)).toEqual(['mag']);
  });

  it('always carries the disclaimer flag, including when gated', () => {
    expect(generateProtocol(config(), [], answers()).disclaimer).toBe(true);
    expect(generateProtocol(config(), [], answers({ restrictedLifeStage: true })).disclaimer).toBe(
      true,
    );
  });
});
