-- =============================================================================
-- 23 · BioHack personalisation — who the customer is, as rules the admin owns
-- Source: docs/15 §9 (added with this migration).
-- =============================================================================

/*
 * The generator asked what someone wants and nothing about them. This adds five answers — age
 * band, sex, weight band, height band, activity level — and, more importantly, the mechanism that
 * turns them into a different protocol.
 *
 * **The mechanism is a table, not code.** The obvious implementation is a function in the engine
 * that says "if age >= 50, weight B12 higher". That would work and it would be wrong for this
 * project: nobody outside the repository could see the rule, and the product manager who
 * understands the nutrition could never change it. So each adjustment is a row, versioned with
 * the config that owns it, editable in `/admin/biohack`, and reported in the trace when it fires.
 * The engine evaluates rules; it does not know any of them.
 *
 * That also keeps the compliance story intact: a rule carries copy, the copy reaches a customer,
 * so it belongs inside the same draft → pending_review → approved cycle as everything else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Bands, never exact values, and that is a product decision as much as a privacy one.
 *
 * A supplement shop has no business holding "72.4 kg, born 12 March 1988". Bands answer every
 * question a rule needs to ask while being useless for identifying anybody, and they are also
 * faster to answer — five taps rather than five keyboards, which is what keeps the flow inside
 * the sixty seconds docs/15 §1 asks for.
 */

-- -----------------------------------------------------------------------------
-- The five answers
-- -----------------------------------------------------------------------------

/*
 * `nen_18` exists so the hard gate can be *derived* rather than self-declared.
 *
 * The flow used to ask "are you pregnant, nursing, or under 18?" as one yes/no — three unrelated
 * questions in a trench coat, and the only one a person might answer carelessly is the one that
 * matters most. Age is asked anyway; asking it once and reading the gate off it is both shorter
 * and harder to get wrong.
 */
create type age_band as enum ('nen_18', '18_29', '30_39', '40_49', '50_64', '65_plus');

/*
 * Sex, because that is the variable the nutrition actually turns on — iron losses, folate,
 * bone density after menopause. `pa_percaktuar` is a first-class answer and not a fallback: a
 * customer may decline, and the engine's response is to apply **no** sex-conditioned rule at all,
 * which is the conservative direction. Never inferred from a name or anything else.
 */
create type sex_band as enum ('femer', 'mashkull', 'pa_percaktuar');

create type weight_band as enum ('nen_60', '60_74', '75_89', '90_104', '105_plus');
create type height_band as enum ('nen_160', '160_169', '170_179', '180_189', '190_plus');

/*
 * Activity is what the customer *does*, distinct from `level` (`fillestar` / `i_avancuar`), which
 * is how much complexity they want in the protocol. A beginner who trains five times a week and
 * an advanced supplement user who sits all day are different people and the two answers were
 * conflated before this.
 */
create type activity_band as enum ('ulur', 'i_lehte', 'i_rregullt', 'intensiv');

-- -----------------------------------------------------------------------------
-- Profile rules
-- -----------------------------------------------------------------------------

/*
 * One row = "for this kind of person, do this to this ingredient".
 *
 * `when_profile` and `effect` are jsonb rather than columns because the shape of a condition is
 * genuinely open — an admin may want age alone, or sex plus activity, and modelling that as
 * nullable columns produces a table where most cells are empty and the meaning of a null is
 * ambiguous. The engine reads a fixed set of keys and ignores anything else, so an unknown key is
 * inert rather than dangerous.
 *
 *   when_profile  {"age_bands":["50_64","65_plus"], "sexes":["femer"],
 *                  "activity":["i_rregullt","intensiv"], "weight_bands":[...],
 *                  "height_bands":[...], "goals":["gjumi"]}
 *
 *   effect        {"weight_delta": 20}      nudge the score, positive or negative
 *                 {"exclude": true}         remove the ingredient entirely
 *                 {"require": true}         guarantee it a place if it survived the filters
 *                 {"servings_hint": true}   ask the UI to show a body-weight serving note
 *
 * An empty `when_profile` matches everybody. That is deliberate and occasionally useful — a rule
 * that always fires is how you attach a standing caution to an ingredient — but the admin form
 * warns, because it is far more often a mistake.
 */
create table protocol_profile_rules (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references protocol_configs(id) on delete cascade,

  /*
   * Null `ingredient_id` means the rule applies to every candidate, which is only sensible
   * alongside a narrow `when_profile` — used by the seeded "65+ carries a standing caution" rule.
   */
  ingredient_id uuid references ingredients(id) on delete cascade,

  when_profile jsonb not null default '{}'::jsonb,
  effect jsonb not null,

  /*
   * The sentence a customer reads when this rule changed their protocol. Required, because a
   * personalised recommendation that cannot explain itself is the thing docs/15 exists to avoid —
   * and because "we weighted this higher for you" with no reason is worse than silence.
   */
  reason_i18n jsonb not null,

  /** Attached to the item when the effect is a caution rather than a score change. */
  caution_i18n jsonb,

  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint protocol_profile_rule_effect_not_empty check (effect <> '{}'::jsonb)
);

create index protocol_profile_rules_config on protocol_profile_rules (config_id, sort_order);

create trigger protocol_profile_rules_updated_at
  before update on protocol_profile_rules
  for each row execute function public.set_updated_at();

/*
 * Same policies as the rest of the ruleset: staff read, product_manager and admin write, no anon
 * policy at all. The storefront reaches these only through the service client inside the engine
 * loader, exactly like blocks and conflicts (docs/02 §6).
 */
alter table protocol_profile_rules enable row level security;

create policy p_staff_read on protocol_profile_rules for select
  using ((select is_staff()));
create policy p_pm_write on protocol_profile_rules for all
  using ((select has_any_role('{product_manager,admin}')))
  with check ((select has_any_role('{product_manager,admin}')));

-- -----------------------------------------------------------------------------
-- Ingredient flags the rules need
-- -----------------------------------------------------------------------------

/*
 * `scales_with_body_weight` marks the ingredients whose sensible intake genuinely tracks body
 * mass — protein and creatine, in this catalogue.
 *
 * It exists so the result page can say "at your weight band, two servings" **without the engine
 * inventing a dose**. The number shown is derived from the product's own label serving, never
 * computed by us: docs/08 §7 territory, and the line between "here is how many of the
 * manufacturer's servings your body mass suggests" and "here is your dose" is one to stay well
 * behind.
 */
alter table ingredients
  add column if not exists scales_with_body_weight boolean not null default false;

comment on column ingredients.scales_with_body_weight is
  'Intake tracks body mass (protein, creatine). Drives a serving hint on the result page, never a dose.';
