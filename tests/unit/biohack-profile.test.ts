import { describe, expect, it } from 'vitest';
import { generateProtocol } from '@/features/biohack/engine';
import type {
  ProfileRule,
  ProtocolBlock,
  ProtocolConfig,
  ProtocolInputs,
} from '@/features/biohack/types';

/**
 * docs/15 §9 — personalisation, as cases.
 *
 * The profile step is the one place where the engine acts on data it does not understand, so these
 * cases are about the **interpreter**, not about nutrition.
 *
 * Nothing here asserts that B12 absorption falls after fifty. That claim lives in a database row,
 * is checked against the shipped ruleset in `tests/integration/biohack.test.ts`, and belongs to
 * the product manager. What is asserted here is that a row saying so has exactly the effect it
 * says and no other — which is the property that makes it safe to hand them the controls.
 *
 * A separate file from `biohack-engine.test.ts` because it is a separate concern, and because
 * these fixtures need profile rules in almost every case where those need almost none.
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

const SETTINGS: ProtocolConfig['settings'] = {
  maxItems: 5,
  minItems: 2,
  maxGoals: 3,
  perGoalCoreGuarantee: true,
  durationDays: 28,
  budgetTiers: [2000, 4000],
  subscriptionConvert: true,
};

function config(over: Partial<ProtocolConfig> = {}): ProtocolConfig {
  return {
    version: 1,
    blocks: [],
    conflicts: [],
    profileRules: [],
    metrics: {},
    settings: SETTINGS,
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

/** Every dimension empty, no effect — each test adds only what it is about. */
function rule(over: Partial<ProfileRule> = {}): ProfileRule {
  return {
    id: 'r-1',
    ingredientSlug: null,
    ingredientName: null,
    when: { ageBands: [], sexes: [], weightBands: [], heightBands: [], activity: [], goals: [] },
    effect: {},
    reason: { sq: 'arsye', en: 'reason' },
    caution: null,
    active: true,
    sortOrder: 0,
    ...over,
  };
}

/** A condition with one dimension filled in, spelled out so the tests stay readable. */
function when(over: Partial<ProfileRule['when']>): ProfileRule['when'] {
  return {
    ageBands: [],
    sexes: [],
    weightBands: [],
    heightBands: [],
    activity: [],
    goals: [],
    ...over,
  };
}

/** `low` sits beneath `high`, so a boost has something to overtake. */
const twoBlocks = (): ProtocolBlock[] => [
  block({ goalSlug: 'gjumi', ingredientSlug: 'high', weight: 80 }),
  block({ goalSlug: 'gjumi', ingredientSlug: 'low', weight: 20 }),
];

const keys = (result: { items: { key: string }[] }): string[] => result.items.map((i) => i.key);
const score = (
  result: { items: { key: string; score: number }[] },
  key: string,
): number | undefined => result.items.find((i) => i.key === key)?.score;

// ── Matching ─────────────────────────────────────────────────────────────────

describe('which rules fire', () => {
  it('an empty condition matches everybody', () => {
    const c = config({
      blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'x' })],
      profileRules: [rule({ effect: { weightDelta: 10 } })],
    });
    expect(score(generateProtocol(c, [], answers({ ageBand: '30_39' })), 'x')).toBe(60);
  });

  it('every named dimension must match, not merely one of them', () => {
    const c = config({
      blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'x' })],
      profileRules: [
        rule({
          when: when({ ageBands: ['50_64'], sexes: ['femer'] }),
          effect: { weightDelta: 10 },
        }),
      ],
    });

    // Age matches, sex does not.
    expect(
      score(generateProtocol(c, [], answers({ ageBand: '50_64', sex: 'mashkull' })), 'x'),
    ).toBe(50);
    expect(score(generateProtocol(c, [], answers({ ageBand: '50_64', sex: 'femer' })), 'x')).toBe(
      60,
    );
  });

  /**
   * An unanswered band matches nothing, which is deliberately the same behaviour as declining.
   *
   * It has to be, or `pa_percaktuar` would be a lie: someone who declines to state their sex must
   * not quietly receive the rules written for one.
   */
  it('a missing answer matches no rule that names that dimension', () => {
    const c = config({
      blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'x' })],
      profileRules: [rule({ when: when({ ageBands: ['50_64'] }), effect: { weightDelta: 10 } })],
    });
    expect(score(generateProtocol(c, [], answers()), 'x')).toBe(50);
  });

  it('declining to state sex applies no sex-conditioned rule at all', () => {
    const c = config({
      blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'x' })],
      profileRules: [
        rule({ when: when({ sexes: ['femer', 'mashkull'] }), effect: { weightDelta: 30 } }),
      ],
    });
    expect(score(generateProtocol(c, [], answers({ sex: 'pa_percaktuar' })), 'x')).toBe(50);
  });

  it('a goal condition fires only when that goal was chosen', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'x' }),
        block({ goalSlug: 'stresi', ingredientSlug: 'y' }),
      ],
      profileRules: [
        rule({
          ingredientSlug: 'x',
          when: when({ goals: ['energji'] }),
          effect: { weightDelta: 40 },
        }),
      ],
    });
    const result = generateProtocol(c, [], answers({ goals: ['gjumi', 'stresi'] }));
    expect(score(result, 'x')).toBe(50);
  });

  it('activity and weight bands match like the rest', () => {
    const c = config({
      blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'x' })],
      profileRules: [
        rule({
          when: when({ activity: ['intensiv'], weightBands: ['90_104', '105_plus'] }),
          effect: { weightDelta: 25 },
        }),
      ],
    });

    expect(
      score(generateProtocol(c, [], answers({ activity: 'intensiv', weightBand: '90_104' })), 'x'),
    ).toBe(75);
    expect(
      score(generateProtocol(c, [], answers({ activity: 'intensiv', weightBand: '60_74' })), 'x'),
    ).toBe(50);
  });

  it('ignores an inactive rule', () => {
    const c = config({
      blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'x' })],
      profileRules: [rule({ active: false, effect: { weightDelta: 40 } })],
    });
    expect(score(generateProtocol(c, [], answers()), 'x')).toBe(50);
  });

  it('a rule naming an ingredient touches only that ingredient', () => {
    const c = config({
      blocks: twoBlocks(),
      profileRules: [rule({ ingredientSlug: 'low', effect: { weightDelta: 5 } })],
    });
    const result = generateProtocol(c, [], answers());
    expect(score(result, 'high')).toBe(80);
    expect(score(result, 'low')).toBe(25);
  });
});

// ── Effects ──────────────────────────────────────────────────────────────────

describe('what a rule does', () => {
  it('a boost can change the order of the protocol', () => {
    expect(keys(generateProtocol(config({ blocks: twoBlocks() }), [], answers()))).toEqual([
      'high',
      'low',
    ]);

    const after = generateProtocol(
      config({
        blocks: twoBlocks(),
        profileRules: [rule({ ingredientSlug: 'low', effect: { weightDelta: 70 } })],
      }),
      [],
      answers(),
    );
    expect(keys(after), 'low overtakes high, 90 against 80').toEqual(['low', 'high']);
  });

  /**
   * A demotion stops at 1 rather than going negative.
   *
   * A negative score would sort below an ingredient nothing recommends at all — a way of excluding
   * something while claiming only to have demoted it. An admin who means "remove" has `exclude`,
   * and the two should not be reachable by the same control.
   */
  it('a negative delta demotes without removing, and never passes 1', () => {
    const c = config({
      blocks: twoBlocks(),
      profileRules: [rule({ ingredientSlug: 'high', effect: { weightDelta: -100 } })],
    });
    const result = generateProtocol(c, [], answers());

    expect(
      result.items.some((i) => i.key === 'high'),
      'demoted, not excluded',
    ).toBe(true);
    expect(score(result, 'high')).toBe(1);
    expect(keys(result)).toEqual(['low', 'high']);
  });

  it('exclude removes the ingredient and records why', () => {
    const c = config({
      blocks: twoBlocks(),
      profileRules: [rule({ ingredientSlug: 'high', effect: { exclude: true } })],
    });
    const result = generateProtocol(c, [], answers());

    expect(keys(result)).toEqual(['low']);
    expect(result.trace.some((t) => t.kind === 'profile_excluded' && t.subject === 'high')).toBe(
      true,
    );
  });

  /**
   * `require` outranks the per-goal core guarantee, making it the strongest claim on a slot.
   *
   * The seeded case is B12 for a vegan: the goals they chose may have nothing to do with it, so
   * without this the item loses every slot to higher-scoring candidates and the one thing their
   * diet actually calls for is the one thing missing.
   */
  it('require wins a slot that score alone never would', () => {
    const blocks = [
      block({ goalSlug: 'gjumi', ingredientSlug: 'a', weight: 90 }),
      block({ goalSlug: 'gjumi', ingredientSlug: 'b', weight: 80 }),
      block({ goalSlug: 'gjumi', ingredientSlug: 'tiny', weight: 5 }),
    ];
    const settings = { ...SETTINGS, maxItems: 2 };

    expect(keys(generateProtocol(config({ blocks, settings }), [], answers()))).not.toContain(
      'tiny',
    );

    const withRule = generateProtocol(
      config({
        blocks,
        settings,
        profileRules: [rule({ ingredientSlug: 'tiny', effect: { require: true } })],
      }),
      [],
      answers(),
    );
    expect(keys(withRule)).toContain('tiny');
  });

  it('attaches a caution from the rule', () => {
    const c = config({
      blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'x' })],
      profileRules: [
        rule({
          when: when({ ageBands: ['65_plus'] }),
          effect: { weightDelta: 1 },
          caution: { sq: 'kujdes', en: 'careful' },
        }),
      ],
    });
    expect(generateProtocol(c, [], answers({ ageBand: '65_plus' })).items[0]?.caution).toEqual({
      sq: 'kujdes',
      en: 'careful',
    });
  });
});

// ── The serving hint ─────────────────────────────────────────────────────────

describe('the body-weight serving hint', () => {
  const c = config({
    blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'protein' })],
    profileRules: [rule({ ingredientSlug: 'protein', effect: { servingsHint: true } })],
  });

  it('reads the multiplier from the weight band', () => {
    expect(
      generateProtocol(c, [], answers({ weightBand: '105_plus' })).items[0]?.servingsHint,
    ).toBe(3);
    expect(generateProtocol(c, [], answers({ weightBand: 'nen_60' })).items[0]?.servingsHint).toBe(
      1,
    );
  });

  /** A multiplier with nothing to multiply against is arithmetic dressed as advice. */
  it('is null when no weight band was given', () => {
    expect(generateProtocol(c, [], answers()).items[0]?.servingsHint).toBeNull();
  });

  it('is null for an item no rule asked about', () => {
    const plain = config({ blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'x' })] });
    expect(
      generateProtocol(plain, [], answers({ weightBand: '75_89' })).items[0]?.servingsHint,
    ).toBeNull();
  });
});

// ── What the customer is told ────────────────────────────────────────────────

describe('what the customer is told about it', () => {
  it('carries the reason onto the item', () => {
    const c = config({
      blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'x' })],
      profileRules: [
        rule({ effect: { weightDelta: 10 }, reason: { sq: 'sepse 50+', en: 'because 50+' } }),
      ],
    });
    expect(generateProtocol(c, [], answers()).items[0]?.profileReasons).toEqual([
      { sq: 'sepse 50+', en: 'because 50+' },
    ]);
  });

  /**
   * A rule whose every effect is a no-op has not personalised anything.
   *
   * Claiming otherwise is the exact theatre this feature exists to avoid, and it is easy to reach
   * by accident: the admin form lets someone write a reason and forget the effect.
   */
  it('says nothing when the rule did nothing', () => {
    const c = config({
      blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'x' })],
      profileRules: [rule({ effect: {} })],
    });
    expect(generateProtocol(c, [], answers()).items[0]?.profileReasons).toEqual([]);
  });

  it('does not repeat a sentence two rules happen to share', () => {
    const shared = { sq: 'e njëjta', en: 'the same' };
    const c = config({
      blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'x' })],
      profileRules: [
        rule({ id: 'r-a', effect: { weightDelta: 5 }, reason: shared }),
        rule({ id: 'r-b', effect: { weightDelta: 5 }, reason: shared }),
      ],
    });
    const item = generateProtocol(c, [], answers()).items[0];

    expect(item?.score, 'both deltas applied').toBe(60);
    expect(item?.profileReasons, 'but the sentence appears once').toHaveLength(1);
  });

  /** An excluded candidate is gone; explaining a boost it never kept would be nonsense. */
  it('an excluded ingredient collects no boost and no reason', () => {
    const c = config({
      blocks: [
        block({ goalSlug: 'gjumi', ingredientSlug: 'x' }),
        block({ goalSlug: 'gjumi', ingredientSlug: 'y' }),
      ],
      profileRules: [
        rule({ id: 'r-a', ingredientSlug: 'x', effect: { exclude: true } }),
        rule({ id: 'r-b', ingredientSlug: 'x', effect: { weightDelta: 40 } }),
      ],
    });
    const result = generateProtocol(c, [], answers());

    expect(keys(result)).toEqual(['y']);
    expect(result.trace.some((t) => t.kind === 'profile_boost' && t.subject === 'x')).toBe(false);
  });

  it('applies rules in the order the admin set', () => {
    const c = config({
      blocks: [block({ goalSlug: 'gjumi', ingredientSlug: 'x' })],
      profileRules: [
        rule({ id: 'r-second', sortOrder: 2, effect: { weightDelta: 10 } }),
        rule({ id: 'r-first', sortOrder: 1, effect: { weightDelta: -20 } }),
      ],
    });

    const order = generateProtocol(c, [], answers())
      .trace.filter((t) => t.kind === 'profile_boost' || t.kind === 'profile_demote')
      .map((t) => t.kind);

    expect(order).toEqual(['profile_demote', 'profile_boost']);
  });

  it('is deterministic across two identical runs', () => {
    const c = config({
      blocks: twoBlocks(),
      profileRules: [
        rule({ id: 'r-a', ingredientSlug: 'low', effect: { weightDelta: 70 } }),
        rule({ id: 'r-b', effect: { servingsHint: true } }),
      ],
    });
    const input = answers({
      ageBand: '40_49',
      sex: 'femer',
      weightBand: '75_89',
      activity: 'intensiv',
    });

    expect(JSON.stringify(generateProtocol(c, [], input))).toBe(
      JSON.stringify(generateProtocol(c, [], input)),
    );
  });
});
