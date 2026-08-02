import {
  SLOT_DAY_PART,
  type CatalogProduct,
  type ProtocolBlock,
  type ProtocolConfig,
  type ProtocolInputs,
  type ProtocolItem,
  type ProtocolResult,
  type TimingSlot,
  type TraceEntry,
} from '@/features/biohack/types';

/**
 * docs/15 §3 — the protocol engine.
 *
 * **Pure.** No I/O, no clock, no randomness. Same config + same catalogue + same answers ⇒
 * byte-identical output, with every tie broken by slug so the order cannot drift between two
 * runs on the same data. That is what makes the ≥25 cases in `tests/unit/biohack-engine.test.ts`
 * meaningful, and it is what lets the admin simulator show a draft's real behaviour rather than
 * an approximation of it.
 *
 * It is also why a stored protocol reproduces: `generated_protocols` keeps the inputs and the
 * config version, so the same pair regenerates the same result forever.
 *
 * The order of the steps is load-bearing and matches docs/15 §3.1–§3.10. Filters run before
 * conflicts, conflicts before selection, selection before budget, budget before product
 * resolution — moving any of them changes what a customer is told and why.
 */

/** How many swap options travel with a result. Six is more than the five items it can replace. */
const MAX_ALTERNATES = 6;

/** A habit has no slug, so it is keyed on its Albanian text, normalised. */
function habitKey(text: string): string {
  return `habit:${text.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 60)}`;
}

function blockKey(block: ProtocolBlock): string {
  return block.ingredientSlug ?? habitKey(block.habit?.sq ?? block.id);
}

/** One ingredient or habit, with the weights of every chosen goal it serves summed. */
interface Candidate {
  key: string;
  kind: 'supplement' | 'habit';
  ingredientSlug: string | null;
  name: { sq: string; en: string };
  /** The highest-weighted block wins the copy; the rest only contribute score. */
  lead: ProtocolBlock;
  blocks: ProtocolBlock[];
  goalSlugs: string[];
  score: number;
  isCore: boolean;
  timing: TimingSlot[];
  phase: 1 | 2;
}

export function generateProtocol(
  config: ProtocolConfig,
  catalog: CatalogProduct[],
  inputs: ProtocolInputs,
): ProtocolResult {
  const trace: TraceEntry[] = [];
  const goals = inputs.goals.slice(0, config.settings.maxGoals);

  const empty = (gated: boolean): ProtocolResult => ({
    gated,
    goalSlugs: goals,
    durationDays: config.settings.durationDays,
    phased: false,
    items: [],
    alternates: [],
    metrics: { sq: [], en: [] },
    monthlyTotalCents: 0,
    trace,
    configVersion: config.version,
    disclaimer: true,
    medicationCaution: inputs.medication,
  });

  /*
   * 1 · The gate.
   *
   * Pregnancy, nursing and under-18 stop the generator dead — no products, no habits, no
   * "general suggestions". docs/15 §6 is explicit that this renders guidance instead, and the
   * reason is not liability theatre: supplement advice for these groups is genuinely
   * individual, and a plausible-looking stack is worse than none.
   */
  if (inputs.restrictedLifeStage) {
    trace.push({ kind: 'excluded_medication', subject: 'restricted_life_stage' });
    return empty(true);
  }

  // 2 · Candidates — active blocks for the goals actually chosen.
  const relevant = config.blocks.filter((b) => b.active && goals.includes(b.goalSlug));

  // 3 · Synergy. Grouping by key is what makes one ingredient serving two goals outrank one.
  const byKey = new Map<string, Candidate>();

  for (const block of [...relevant].sort(byBlockOrder)) {
    const key = blockKey(block);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        key,
        kind: block.ingredientSlug ? 'supplement' : 'habit',
        ingredientSlug: block.ingredientSlug,
        name: block.ingredientName ?? block.habit ?? { sq: key, en: key },
        lead: block,
        blocks: [block],
        goalSlugs: [block.goalSlug],
        score: block.weight,
        isCore: block.isCore,
        timing: [...block.timing],
        phase: block.phase,
      });
      trace.push({ kind: 'candidate', subject: key, object: block.goalSlug, score: block.weight });
      continue;
    }

    existing.blocks.push(block);
    existing.goalSlugs.push(block.goalSlug);
    existing.score += block.weight;
    existing.isCore = existing.isCore || block.isCore;
    // The earliest phase wins: an ingredient that is foundational for one goal is not deferred
    // because it is optional for another.
    existing.phase = Math.min(existing.phase, block.phase) as 1 | 2;
    for (const slot of block.timing) if (!existing.timing.includes(slot)) existing.timing.push(slot);

    trace.push({ kind: 'candidate', subject: key, object: block.goalSlug, score: block.weight });
    trace.push({ kind: 'synergy', subject: key, score: existing.score, detail: existing.goalSlugs.join('+') });
  }

  let candidates = [...byKey.values()];

  /*
   * 4 · Filters.
   *
   * Medication and caffeine are absolute — they remove the ingredient. Diet is **not** applied
   * here: whether a vegan can take magnesium depends on which product is behind it, and that is
   * not known until step 8. Filtering the ingredient now would drop it even when a compliant
   * product exists.
   */
  candidates = candidates.filter((candidate) => {
    if (inputs.medication && candidate.blocks.some((b) => b.medSensitive)) {
      trace.push({ kind: 'excluded_medication', subject: candidate.key });
      return false;
    }
    if (inputs.caffeine === 'jo' && candidate.blocks.some((b) => b.containsCaffeine)) {
      trace.push({ kind: 'excluded_caffeine', subject: candidate.key });
      return false;
    }
    return true;
  });

  // 5 · Conflicts.
  candidates = applyConflicts(candidates, config, inputs, goals, trace);

  /*
   * `vetëm në mëngjes` composes with any timing rule already applied: a caffeine ingredient that
   * a conflict has restricted to mornings stays restricted, and one that had no rule gains it.
   */
  if (inputs.caffeine === 'vetem_mengjes') {
    for (const candidate of candidates) {
      if (!candidate.blocks.some((b) => b.containsCaffeine)) continue;
      const morning = candidate.timing.filter((slot) => SLOT_DAY_PART[slot] === 'mengjes');
      candidate.timing = morning.length > 0 ? morning : ['mengjes'];
      trace.push({ kind: 'timing_constrained', subject: candidate.key, detail: 'caffeine_morning_only' });
    }
  }

  // 6 · Selection.
  const selected = select(candidates, config, goals, trace);

  // 8 · Product resolution (before the budget, which needs prices).
  const resolved = selected.map((candidate) => resolve(candidate, catalog, inputs, trace));

  // 6b · Budget, greedy by score-per-euro, never dropping a per-goal core.
  const withinBudget = applyBudget(resolved, config, goals, inputs.budgetCents, trace);

  /*
   * The swap pool.
   *
   * Everything that survived the filters and did not make the final list, resolved against the
   * catalogue so a swap can show a real price immediately. Two deliberate exclusions: a
   * supplement with nothing purchasable behind it, because swapping to "së shpejti" is not an
   * alternative, and anything already on the list.
   *
   * Resolution runs against a throwaway trace. These are decisions about items the customer is
   * not being shown, and "no stock for X" in the explanation of a protocol that never mentioned X
   * reads as a defect.
   */
  const shown = new Set(withinBudget.map((item) => item.key));
  const alternates = candidates
    .filter((candidate) => !shown.has(candidate.key))
    .sort(bestFirst)
    .map((candidate) => resolve(candidate, catalog, inputs, []))
    .filter((item) => item.kind === 'habit' || !item.comingSoon)
    .slice(0, MAX_ALTERNATES);

  // 7 · Phasing.
  const phased = inputs.level === 'fillestar' && withinBudget.some((item) => item.phase === 2);
  if (inputs.level === 'i_avancuar') {
    for (const item of [...withinBudget, ...alternates]) item.phase = 1;
  } else {
    for (const item of withinBudget) {
      if (item.phase === 2) trace.push({ kind: 'phase_deferred', subject: item.key });
    }
  }

  return {
    gated: false,
    goalSlugs: goals,
    durationDays: config.settings.durationDays,
    phased,
    items: withinBudget,
    alternates,
    metrics: collectMetrics(config, goals),
    monthlyTotalCents: withinBudget.reduce((sum, i) => sum + (i.product?.priceCents ?? 0), 0),
    trace,
    configVersion: config.version,
    disclaimer: true,
    medicationCaution: inputs.medication,
  };
}

/** Deterministic block order: heaviest first, then by key, so grouping never depends on input order. */
function byBlockOrder(a: ProtocolBlock, b: ProtocolBlock): number {
  if (b.weight !== a.weight) return b.weight - a.weight;
  const ka = blockKey(a);
  const kb = blockKey(b);
  if (ka !== kb) return ka.localeCompare(kb);
  return a.goalSlug.localeCompare(b.goalSlug);
}

/** Score descending, then key — the tiebreak that makes the whole engine reproducible. */
function bestFirst(a: { score: number; key: string }, b: { score: number; key: string }): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.key.localeCompare(b.key);
}

/**
 * 5 · The conflict matrix, applied in a fixed order: exclude, then timing, then caution.
 *
 * Order matters. An excluded ingredient must not first pick up a timing constraint and a caution
 * note that then appear in the trace for something the customer never sees.
 */
function applyConflicts(
  candidates: Candidate[],
  config: ProtocolConfig,
  inputs: ProtocolInputs,
  goals: string[],
  trace: TraceEntry[],
): Candidate[] {
  const present = new Map(candidates.map((c) => [c.ingredientSlug ?? c.key, c]));
  const dropped = new Set<string>();

  const matches = (conflict: ProtocolConflict_, candidate: Candidate): boolean =>
    conflict.aIngredientSlug !== null && conflict.aIngredientSlug === candidate.ingredientSlug;

  type ProtocolConflict_ = (typeof config.conflicts)[number];

  const ordered = [...config.conflicts].sort((a, b) => a.id.localeCompare(b.id));

  for (const conflict of ordered.filter((c) => c.kind === 'exclude')) {
    const a = candidates.find((c) => matches(conflict, c));
    if (!a) continue;

    // Against another ingredient: the lower score goes. Against a chosen goal: `a` goes.
    if (conflict.bIngredientSlug) {
      const b = present.get(conflict.bIngredientSlug);
      if (!b) continue;
      const loser = a.score <= b.score ? a : b;
      dropped.add(loser.key);
      trace.push({
        kind: 'excluded_conflict',
        subject: loser.key,
        object: (loser === a ? b : a).key,
        detail: 'exclude',
      });
    } else if (conflict.bGoalSlug && goals.includes(conflict.bGoalSlug)) {
      dropped.add(a.key);
      trace.push({ kind: 'excluded_conflict', subject: a.key, object: conflict.bGoalSlug, detail: 'exclude' });
    }
  }

  const surviving = candidates.filter((c) => !dropped.has(c.key));

  for (const conflict of ordered.filter((c) => c.kind === 'timing_rule')) {
    const a = surviving.find((c) => matches(conflict, c));
    if (!a) continue;

    const triggered =
      (conflict.bGoalSlug !== null && goals.includes(conflict.bGoalSlug)) ||
      (conflict.bIngredientSlug !== null &&
        surviving.some((c) => c.ingredientSlug === conflict.bIngredientSlug));
    if (!triggered) continue;

    const allowed = conflict.rule.allowedSlots ?? [];
    if (allowed.length > 0) {
      const narrowed = a.timing.filter((slot) => allowed.includes(slot));
      // Never leave an item with no time at all — fall back to the rule's own first slot.
      a.timing = narrowed.length > 0 ? narrowed : [...allowed];
      trace.push({
        kind: 'timing_constrained',
        subject: a.key,
        object: conflict.bGoalSlug ?? conflict.bIngredientSlug ?? undefined,
        detail: a.timing.join(','),
      });
    }
  }

  for (const conflict of ordered.filter((c) => c.kind === 'caution')) {
    const a = surviving.find((c) => matches(conflict, c));
    if (!a || !conflict.note) continue;

    const triggered =
      (conflict.bGoalSlug !== null && goals.includes(conflict.bGoalSlug)) ||
      (conflict.bIngredientSlug !== null &&
        surviving.some((c) => c.ingredientSlug === conflict.bIngredientSlug));
    if (!triggered) continue;

    // Attached to the lead block so it travels with the copy into the item.
    a.lead = { ...a.lead, caution: conflict.note };
    trace.push({ kind: 'caution_attached', subject: a.key });
  }

  // Unused when `medication` is false, but the reference keeps the signature honest.
  void inputs;

  return surviving;
}

/**
 * 6 · Selection: one core per goal first, then the best of the rest.
 *
 * The guarantee runs before the global fill so that a goal whose best block scores low still
 * gets representation — otherwise picking "sleep + energy" where energy has three heavily
 * weighted ingredients would return a protocol with nothing for sleep in it, which is not a
 * protocol for what was asked.
 */
function select(
  candidates: Candidate[],
  config: ProtocolConfig,
  goals: string[],
  trace: TraceEntry[],
): Candidate[] {
  const ranked = [...candidates].sort(bestFirst);
  const chosen: Candidate[] = [];
  const taken = new Set<string>();

  if (config.settings.perGoalCoreGuarantee) {
    for (const goal of goals) {
      const core = ranked.find(
        (c) => !taken.has(c.key) && c.goalSlugs.includes(goal) && c.isCore,
      );
      const fallback = ranked.find((c) => !taken.has(c.key) && c.goalSlugs.includes(goal));
      const pick = core ?? fallback;
      if (!pick) continue;
      chosen.push(pick);
      taken.add(pick.key);
      trace.push({ kind: 'core_guaranteed', subject: pick.key, object: goal });
    }
  }

  for (const candidate of ranked) {
    if (chosen.length >= config.settings.maxItems) break;
    if (taken.has(candidate.key)) continue;
    chosen.push(candidate);
    taken.add(candidate.key);
  }

  return chosen.sort(bestFirst).slice(0, config.settings.maxItems);
}

/**
 * 8 · Product resolution.
 *
 * Ranked featured → rating → price-per-serving, exactly as docs/15 §3.8 specifies. Diet is
 * applied here rather than at the ingredient, so an ingredient survives when *any* compliant
 * product exists behind it.
 */
function resolve(
  candidate: Candidate,
  catalog: CatalogProduct[],
  inputs: ProtocolInputs,
  trace: TraceEntry[],
): ProtocolItem {
  const base: ProtocolItem = {
    kind: candidate.kind,
    key: candidate.key,
    name: candidate.name,
    why: candidate.lead.why,
    goalSlugs: [...new Set(candidate.goalSlugs)],
    timing: candidate.timing,
    phase: candidate.phase,
    evidence: candidate.lead.evidence,
    caution: candidate.lead.caution,
    score: candidate.score,
    product: null,
    comingSoon: false,
  };

  if (candidate.kind === 'habit' || !candidate.ingredientSlug) return base;

  const slug = candidate.ingredientSlug;
  const matching = catalog.filter((p) => p.ingredientSlugs.includes(slug));
  const compliant = matching.filter((p) => passesDiet(p, inputs.diet));

  if (compliant.length === 0) {
    trace.push({ kind: 'excluded_diet', subject: candidate.key, detail: inputs.diet });
    return { ...base, comingSoon: true };
  }

  const inStock = compliant.filter((p) => p.inStock).sort(byProductRank);

  if (inStock.length === 0) {
    trace.push({ kind: 'no_stock', subject: candidate.key });
    return { ...base, comingSoon: true };
  }

  const best = inStock[0];
  if (!best) return { ...base, comingSoon: true };

  return {
    ...base,
    product: {
      productId: best.productId,
      slug: best.slug,
      variantId: best.variantId,
      priceCents: best.priceCents,
    },
  };
}

function passesDiet(product: CatalogProduct, diet: ProtocolInputs['diet']): boolean {
  if (diet === 'pa_kufizime') return true;
  if (diet === 'vegan') return product.dietaryTags.includes('vegan');
  return product.dietaryTags.includes('vegan') || product.dietaryTags.includes('vegetarian');
}

function byProductRank(a: CatalogProduct, b: CatalogProduct): number {
  if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
  if (b.ratingAvg !== a.ratingAvg) return b.ratingAvg - a.ratingAvg;
  if (a.pricePerServingCents !== b.pricePerServingCents) {
    return a.pricePerServingCents - b.pricePerServingCents;
  }
  return a.slug.localeCompare(b.slug);
}

/**
 * 6b · Budget.
 *
 * Greedy by score, keeping anything free (habits and coming-soon items cost nothing) and never
 * dropping an item that is the last remaining representative of one of the chosen goals. That
 * last clause is the per-goal core guarantee surviving the budget — docs/15 §3.6 — and it is the
 * rule the Finder got wrong first time round (docs/13 §P7): trimming to fit and then topping
 * back up quietly undoes the trim.
 */
function applyBudget(
  items: ProtocolItem[],
  config: ProtocolConfig,
  goals: string[],
  budgetCents: number | null,
  trace: TraceEntry[],
): ProtocolItem[] {
  if (budgetCents === null || budgetCents <= 0) return items;

  const kept: ProtocolItem[] = [];
  let total = 0;

  for (const item of [...items].sort(bestFirst)) {
    const price = item.product?.priceCents ?? 0;

    if (price === 0 || total + price <= budgetCents) {
      kept.push(item);
      total += price;
      continue;
    }

    // Would this cut leave one of the customer's goals with nothing?
    const orphaned = item.goalSlugs.filter(
      (goal) => goals.includes(goal) && !kept.some((k) => k.goalSlugs.includes(goal)),
    );

    if (orphaned.length > 0) {
      kept.push(item);
      total += price;
      trace.push({ kind: 'core_guaranteed', subject: item.key, object: orphaned.join('+'), detail: 'over_budget' });
      continue;
    }

    trace.push({ kind: 'budget_cut', subject: item.key, score: price });
  }

  /*
   * Below the minimum after the cut, the budget loses. A protocol of one item is not a protocol,
   * and the result page shows the monthly total — so a customer can see it does not fit and
   * decide for themselves, which is better than being handed something that is not a routine.
   */
  if (kept.length < Math.min(config.settings.minItems, items.length)) {
    return items.slice(0, Math.max(config.settings.minItems, kept.length));
  }

  return kept.sort(bestFirst);
}

/** The union of the chosen goals' metric templates, in goal order, deduplicated. */
function collectMetrics(config: ProtocolConfig, goals: string[]): { sq: string[]; en: string[] } {
  const sq: string[] = [];
  const en: string[] = [];

  for (const goal of goals) {
    const template = config.metrics[goal];
    if (!template) continue;
    for (const line of template.sq) if (!sq.includes(line)) sq.push(line);
    for (const line of template.en) if (!en.includes(line)) en.push(line);
  }

  return { sq, en };
}
