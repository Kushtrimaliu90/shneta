-- =============================================================================
-- 21 · BioHack Protocol Generator
-- Source: docs/15 §2.
-- =============================================================================

/*
 * A versioned, compliance-gated ruleset plus a log of what it produced.
 *
 * The shape to understand before reading the rest: `protocol_configs` is a **version**, and
 * everything else hangs off one. Editing the matrix never mutates what the storefront is using —
 * it edits a draft, which becomes live only when compliance approves it. That is the whole
 * reason for the indirection, and it is the same reason products have `pending_review`: the
 * copy in `why_i18n` is a health claim about a supplement, and docs/08 §7 does not allow those
 * to reach a customer without a reviewer.
 *
 * The names are brand-neutral on purpose (docs/15 §0): `protocol_*`, not `biohack_*`. The
 * feature can be renamed by marketing without a migration.
 */

create type timing_slot as enum (
  'mengjes', 'dite', 'mbremje', 'para_gjumit', 'me_ushqim', 'para_stervitjes'
);

create type conflict_kind as enum ('exclude', 'caution', 'timing_rule');

-- -----------------------------------------------------------------------------
-- The versioned ruleset
-- -----------------------------------------------------------------------------

create table protocol_configs (
  id uuid primary key default gen_random_uuid(),
  version int generated always as identity,
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'approved', 'archived')),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/*
 * At most one approved version at a time.
 *
 * The engine reads "the latest approved config", and two of them would make that phrase
 * ambiguous — the storefront would pick by `version desc` and the other would sit there looking
 * live. Approving is therefore an archive-then-approve pair, enforced here rather than trusted
 * to the action (docs/13 §B: the constraint belongs where it cannot be forgotten).
 */
create unique index one_approved_protocol_config
  on protocol_configs ((status)) where status = 'approved';

create trigger protocol_configs_updated_at
  before update on protocol_configs
  for each row execute function public.set_updated_at();

/*
 * One row = "this ingredient, or this habit, is relevant to this goal, this much".
 *
 * A block is per-goal, not per-protocol: the synergy effect in docs/15 §3.3 comes from the same
 * ingredient appearing under two goals and having its weights summed when a customer picks both.
 * Modelling it the other way — a protocol template per goal combination — is 16 choose 3 = 560
 * templates nobody can maintain.
 */
create table protocol_blocks (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references protocol_configs(id) on delete cascade,
  goal_id uuid not null references health_goals(id),
  ingredient_id uuid references ingredients(id),
  -- Habits have no catalogue row and never will: "10 minutes of daylight" is not a SKU.
  habit_i18n jsonb,
  weight int not null check (weight between 1 and 100),
  is_core boolean not null default false,
  timing timing_slot[] not null default '{mengjes}',
  phase int not null default 1 check (phase in (1, 2)),
  why_i18n jsonb not null,
  evidence evidence_level,
  caution_i18n jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint protocol_block_is_ingredient_or_habit
    check (ingredient_id is not null or habit_i18n is not null)
);

create index protocol_blocks_config_goal on protocol_blocks (config_id, goal_id) where active;
create unique index protocol_blocks_unique_ingredient
  on protocol_blocks (config_id, goal_id, ingredient_id) where ingredient_id is not null;

create trigger protocol_blocks_updated_at
  before update on protocol_blocks
  for each row execute function public.set_updated_at();

/*
 * Rules between two things that should not sit in the same protocol, or not at the same hour.
 *
 * `b_goal` rather than a second ingredient is what expresses "caffeine × sleep": the conflict is
 * not with another supplement, it is with something the customer said they want. Both shapes are
 * one table because the engine applies them in one pass and a second table would mean two.
 */
create table protocol_conflicts (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references protocol_configs(id) on delete cascade,
  a_ingredient uuid references ingredients(id),
  b_ingredient uuid references ingredients(id),
  b_goal uuid references health_goals(id),
  kind conflict_kind not null,
  rule jsonb not null default '{}'::jsonb,
  note_i18n jsonb,
  created_at timestamptz not null default now(),
  -- A rule with nothing on the other side is a no-op that looks like a rule.
  constraint protocol_conflict_has_a_target
    check (b_ingredient is not null or b_goal is not null)
);

create index protocol_conflicts_config on protocol_conflicts (config_id);

-- -----------------------------------------------------------------------------
-- What the engine produced
-- -----------------------------------------------------------------------------

/*
 * A full snapshot of inputs and result, not a set of foreign keys.
 *
 * A protocol shared in March must still render in September even if the config changed, a
 * product was delisted and a price moved. Storing ids would make the shared page a live query
 * against a catalogue that has moved on; storing the result makes it what it was. `config_version`
 * records which ruleset produced it, so compliance can answer "what did we tell this person, and
 * under which approved copy".
 */
create table generated_protocols (
  id uuid primary key default gen_random_uuid(),
  share_code text not null unique,
  user_id uuid references profiles(id) on delete set null,
  config_version int not null,
  inputs jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index generated_protocols_user on generated_protocols (user_id, created_at desc)
  where user_id is not null;

-- -----------------------------------------------------------------------------
-- Catalogue flags the engine filters on
-- -----------------------------------------------------------------------------

alter table ingredients add column if not exists med_sensitive boolean not null default false;
alter table ingredients add column if not exists contains_caffeine boolean not null default false;

comment on column ingredients.med_sensitive is
  'Known to interact with common prescription medication. Excluded outright when the customer '
  'says they take any — docs/15 §1 step 2. A conservative flag: it costs a recommendation, and '
  'the alternative costs an interaction.';

comment on column ingredients.contains_caffeine is
  'Excluded when the customer says no caffeine; constrained to morning slots when they say '
  'mornings only (docs/15 §3.5).';

alter table health_goals add column if not exists metrics_i18n jsonb;

comment on column health_goals.metrics_i18n is
  'What to measure for this goal, as {"sq":[...],"en":[...]}. The union across the chosen goals '
  'is the "Çfarë të masësh" card — the part of a protocol that makes it checkable rather than '
  'a shopping list.';

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table protocol_configs enable row level security;
alter table protocol_blocks enable row level security;
alter table protocol_conflicts enable row level security;
alter table generated_protocols enable row level security;

/*
 * Config is staff-read, product-manager-write. **The storefront never reads these tables.**
 *
 * The engine runs server-side against the latest approved config through the service client, so
 * an anon visitor has no path to the ruleset at all — not the draft copy compliance has not seen,
 * and not the weights, which are commercially interesting. There is deliberately no anon policy
 * rather than an anon policy narrowed to `status = 'approved'`: the narrower policy would still
 * be a door, and this feature does not need one.
 */
create policy p_staff_read on protocol_configs for select
  using ((select is_staff()));
create policy p_pm_write on protocol_configs for all
  using ((select has_any_role('{product_manager,admin}')))
  with check ((select has_any_role('{product_manager,admin}')));

create policy p_staff_read on protocol_blocks for select
  using ((select is_staff()));
create policy p_pm_write on protocol_blocks for all
  using ((select has_any_role('{product_manager,admin}')))
  with check ((select has_any_role('{product_manager,admin}')));

create policy p_staff_read on protocol_conflicts for select
  using ((select is_staff()));
create policy p_pm_write on protocol_conflicts for all
  using ((select has_any_role('{product_manager,admin}')))
  with check ((select has_any_role('{product_manager,admin}')));

/*
 * A customer reads their own protocols; support reads any, to answer "what did you send me".
 * Inserts have **no policy** — they go through the action with the service client, because a
 * guest has no `auth.uid()` and must still be able to generate one (docs/13 §B5).
 */
create policy p_own_read on generated_protocols for select
  using (user_id = (select auth.uid()) or (select has_any_role('{support}')));

-- -----------------------------------------------------------------------------
-- Sharing
-- -----------------------------------------------------------------------------

/**
 * Reads one shared protocol by its code, for anybody holding the link.
 *
 * Security definer with a **narrow return**: the result jsonb and nothing else. `user_id`,
 * `inputs` and `created_at` stay behind the function, so a shared link cannot be used to learn
 * who generated it or what they answered about pregnancy and medication — which is the entire
 * reason this is an RPC rather than an anon select policy on the table.
 *
 * The code is the credential, so it must be unguessable; `generate_access_token()` is the same
 * generator the guest order-lookup path uses.
 */
create or replace function public.get_shared_protocol(p_code text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select result from generated_protocols where share_code = p_code;
$$;

revoke all on function public.get_shared_protocol(text) from public;
grant execute on function public.get_shared_protocol(text) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Engine settings (docs/15 §2)
-- -----------------------------------------------------------------------------

insert into settings (key, value) values (
  'biohack_engine',
  jsonb_build_object(
    'max_items', 5,
    'min_items', 2,
    'max_goals', 3,
    'per_goal_core_guarantee', true,
    'duration_days', 28,
    'budget_tiers', jsonb_build_array(2000, 4000),
    'subscription_convert', true
  )
)
on conflict (key) do update set value = excluded.value;
