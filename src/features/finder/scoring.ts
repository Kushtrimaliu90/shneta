import {
  LIFESTYLE_GOALS,
  type FinderAnswers,
  type ScoredProduct,
} from '@/features/finder/types';

/**
 * docs/05 §10 — "deterministic scoring v1".
 *
 * A pure function of (candidates, answers). No database, no clock, no randomness — which is what
 * makes it unit-testable, and unit tests are the only practical way to be confident about a
 * recommendation engine: the alternative is clicking through the quiz and squinting at whether
 * the answer looks sensible.
 *
 * The rules, in the order docs/05 §10 gives them:
 *
 *   +3   the product targets the primary goal
 *   +1   per secondary goal it targets (lifestyle answers count as secondaries — see
 *        `LIFESTYLE_GOALS`)
 *   ×    filtered out entirely on a dietary conflict or a missing required tag
 *   +    small preferences for rating and being in stock
 *
 * The preferences are deliberately small. A four-star product that matches nothing must never
 * outrank a three-star product that matches the goal the customer actually came in with — so the
 * rating bonus is capped below the value of a single secondary match.
 */

export interface Candidate {
  productId: string;
  slug: string;
  goalSlugs: string[];
  dietaryTags: string[];
  form: string | null;
  ratingAvg: number;
  ratingCount: number;
  inStock: boolean;
  priceCents: number;
  isFeatured: boolean;
}

/** Weights, named so the reasoning above stays checkable against the code. */
const PRIMARY_MATCH = 3;
const SECONDARY_MATCH = 1;
/** Capped below `SECONDARY_MATCH` — see the note above. */
const MAX_RATING_BONUS = 0.8;
const IN_STOCK_BONUS = 0.5;
const FEATURED_BONUS = 0.1;
const FORM_MATCH_BONUS = 0.4;

/** How many products a routine holds (docs/05 §10: "3–5 products"). */
export const MIN_ROUTINE = 3;
export const MAX_ROUTINE = 5;

/**
 * A vegan diet excludes anything not tagged vegan; vegetarian additionally accepts `vegan`.
 *
 * Expressed as "which tag must be present" rather than "which ingredients are animal-derived",
 * because the catalogue records the former and guessing the latter from a product name is how a
 * finder recommends gelatin softgels to a vegan.
 */
function passesDiet(candidate: Candidate, diet: FinderAnswers['diet']): boolean {
  if (diet === 'none') return true;
  if (diet === 'vegan') return candidate.dietaryTags.includes('vegan');
  return candidate.dietaryTags.includes('vegan') || candidate.dietaryTags.includes('vegetarian');
}

function passesRequired(candidate: Candidate, required: readonly string[]): boolean {
  return required.every((tag) => candidate.dietaryTags.includes(tag));
}

/** The goals a customer's answers add up to, deduplicated, primary excluded from the secondaries. */
export function effectiveGoals(answers: FinderAnswers): { primary: string; secondary: string[] } {
  const secondary = new Set(answers.secondary.filter((slug) => slug && slug !== answers.primary));

  const sleepGoal = LIFESTYLE_GOALS.sleep[answers.sleep];
  if (sleepGoal && sleepGoal !== answers.primary) secondary.add(sleepGoal);

  const activityGoal = LIFESTYLE_GOALS.activity[answers.activity];
  if (activityGoal && activityGoal !== answers.primary) secondary.add(activityGoal);

  return { primary: answers.primary, secondary: [...secondary] };
}

export interface RoutineResult {
  products: ScoredProduct[];
  /** True when nothing matched and the routine fell back to bestsellers (docs/05 §10). */
  isFallback: boolean;
}

/**
 * Builds the routine.
 *
 * **Never returns an empty list** while any candidate exists — docs/05 §10 makes that an
 * acceptance criterion, and it is the right call: a quiz that ends in "we have nothing for you"
 * has wasted a minute of somebody's time and taught them the shop is empty. When the filters
 * exclude everything, it falls back to the best-rated in-stock products and says so, which the
 * results page must surface rather than passing off as a match.
 */
export function buildRoutine(candidates: Candidate[], answers: FinderAnswers): RoutineResult {
  const { primary, secondary } = effectiveGoals(answers);

  const eligible = candidates.filter(
    (candidate) => passesDiet(candidate, answers.diet) && passesRequired(candidate, answers.require),
  );

  const scored: ScoredProduct[] = eligible
    .map((candidate) => {
      const reasons: ScoredProduct['reasons'] = [];
      let score = 0;

      if (candidate.goalSlugs.includes(primary)) {
        score += PRIMARY_MATCH;
        reasons.push({ kind: 'primary', goalSlug: primary });
      }

      for (const goal of secondary) {
        if (candidate.goalSlugs.includes(goal)) {
          score += SECONDARY_MATCH;
          reasons.push({ kind: 'secondary', goalSlug: goal });
        }
      }

      /*
       * Rating is scaled by how many people left one. A lone five-star review is not evidence,
       * and without this a brand-new product with one rave outranks a staple with forty.
       */
      if (candidate.ratingCount > 0) {
        const confidence = Math.min(1, candidate.ratingCount / 10);
        const quality = Math.max(0, (candidate.ratingAvg - 3) / 2);
        const bonus = MAX_RATING_BONUS * confidence * quality;
        score += bonus;
        if (bonus > 0.3) reasons.push({ kind: 'rating' });
      }

      if (candidate.inStock) score += IN_STOCK_BONUS;
      if (candidate.isFeatured) score += FEATURED_BONUS;
      if (answers.form !== 'any' && candidate.form === answers.form) score += FORM_MATCH_BONUS;

      return { productId: candidate.productId, slug: candidate.slug, score, reasons };
    })
    // Only products that actually match a goal — a routine of unrelated in-stock items is
    // not a routine, and the fallback below says so honestly instead.
    .filter((product) => product.reasons.some((r) => r.kind === 'primary' || r.kind === 'secondary'))
    .sort(bestFirst);

  const withinBudget = applyBudget(scored, eligible, answers.budgetCents);

  if (withinBudget.length >= MIN_ROUTINE) {
    return { products: withinBudget.slice(0, MAX_ROUTINE), isFallback: false };
  }

  /*
   * Short of a routine. Top up from the same eligible pool — still respecting diet and required
   * tags, because those are constraints rather than preferences. A vegan must not be handed a
   * gelatin capsule to round the number up to three.
   *
   * The budget is a constraint too, and it applies to the top-up. Padding past it would quietly
   * hand back a routine the customer has already said they cannot afford — which is worse than
   * two products, because it looks like the budget field did nothing.
   */
  const priceOf = new Map(eligible.map((c) => [c.productId, c.priceCents]));
  const chosen = new Set(withinBudget.map((product) => product.productId));
  let spent = withinBudget.reduce((sum, p) => sum + (priceOf.get(p.productId) ?? 0), 0);

  const filler = eligible
    .filter((candidate) => !chosen.has(candidate.productId))
    .map((candidate) => ({
      productId: candidate.productId,
      slug: candidate.slug,
      score: (candidate.inStock ? IN_STOCK_BONUS : 0) + candidate.ratingAvg / 10,
      reasons: [{ kind: 'fallback' as const }],
    }))
    .sort(bestFirst);

  const topped = [...withinBudget];
  for (const product of filler) {
    if (topped.length >= MAX_ROUTINE) break;
    const price = priceOf.get(product.productId) ?? 0;
    if (answers.budgetCents !== null && answers.budgetCents > 0 && spent + price > answers.budgetCents) {
      continue;
    }
    topped.push(product);
    spent += price;
  }

  return { products: topped, isFallback: withinBudget.length === 0 };
}

/**
 * Drops the cheapest-to-keep products until the monthly total fits.
 *
 * Greedy from the top of the ranking rather than an optimisation: the customer asked for their
 * best routine under a budget, not for the most products that fit in it, so the highest-scoring
 * item is never the one sacrificed.
 */
function applyBudget(
  scored: ScoredProduct[],
  candidates: Candidate[],
  budgetCents: number | null,
): ScoredProduct[] {
  if (budgetCents === null || budgetCents <= 0) return scored;

  const priceOf = new Map(candidates.map((c) => [c.productId, c.priceCents]));
  const kept: ScoredProduct[] = [];
  let total = 0;

  for (const product of scored) {
    const price = priceOf.get(product.productId) ?? 0;
    if (total + price > budgetCents) continue;
    kept.push(product);
    total += price;
  }

  /*
   * A budget too small for even one product returns the single best match anyway. The results
   * page shows the total, so the customer can see it does not fit — which is more useful than an
   * empty page that does not explain itself.
   */
  return kept.length > 0 ? kept : scored.slice(0, 1);
}

/** Score descending, then slug, so equal scores order the same way on every render. */
function bestFirst(a: ScoredProduct, b: ScoredProduct): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.slug.localeCompare(b.slug);
}

/**
 * docs/05 §10 — the "routine completeness" ring.
 *
 * The share of the customer's goals that the routine actually covers. Not the number of products:
 * five products all aimed at sleep is not a complete routine for someone who also asked about
 * immunity, and a ring that said 100% would be lying.
 */
export function completeness(products: ScoredProduct[], answers: FinderAnswers): number {
  const { primary, secondary } = effectiveGoals(answers);
  const goals = [primary, ...secondary].filter(Boolean);
  if (goals.length === 0) return 0;

  const covered = new Set<string>();
  for (const product of products) {
    for (const reason of product.reasons) {
      if (reason.goalSlug) covered.add(reason.goalSlug);
    }
  }

  return Math.round((covered.size / goals.length) * 100);
}
