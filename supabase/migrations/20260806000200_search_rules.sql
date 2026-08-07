-- =============================================================================
-- 66 · Search merchandising — pin, boost, bury, hide, redirect
-- Source: the search audit, item 9.
-- =============================================================================

/*
 * ── Why this exists now rather than after launch ──
 *
 * With 91 own-catalogue products you can live with whatever the ranking function decides. With third-party
 * merchants uploading freely (docs/16) you cannot: a merchant will ask why their product sits on page
 * three, and "the SQL sorted it that way" is not an answer anyone accepts. Ranking control is a commercial
 * surface, not a nicety.
 *
 * Retrofitting it later is the expensive version. A hand-written `order by` grows a new `case` per
 * exception until nobody can say what the ordering is; a rules table keeps the exceptions as data, visible
 * in one admin screen and auditable.
 *
 * ── Four actions, one table ──
 *
 *   · **pin**   — force to a fixed position. The merchandiser's override.
 *   · **boost** — add to the relevance score. A nudge, still beaten by a much better text match.
 *   · **bury**  — subtract. For the discontinued line you must still sell but never lead with.
 *   · **hide**  — remove from results entirely, without unpublishing the product.
 *
 * Pins and boosts apply **only under `sort=relevance`**. A shopper who explicitly asked for
 * price-ascending has overruled the merchandiser, and quietly re-inserting a pinned product at the top of
 * their cheapest-first list would be a lie about the sort.
 */

create type search_rule_action as enum ('pin', 'boost', 'bury', 'hide');

create table search_rules (
  id uuid primary key default gen_random_uuid(),
  action search_rule_action not null,
  product_id uuid not null references products(id) on delete cascade,
  /*
   * The query this applies to, normalised on write so an operator typing "Vitamina C" and a shopper
   * typing "vitamina c" meet. NULL with `match_type = 'any'` means "every search, and the shop grid too".
   */
  query text,
  match_type text not null default 'exact'
    check (match_type in ('exact', 'contains', 'any')),
  pin_position int,
  weight numeric(6, 2) not null default 0,
  is_active boolean not null default true,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint search_rules_query_shape check (
    (match_type = 'any' and query is null) or (match_type <> 'any' and query is not null)
  ),
  constraint search_rules_pin_shape check (
    action <> 'pin' or (pin_position is not null and pin_position between 1 and 100)
  ),
  -- A boost of zero is a rule that does nothing while looking like it does something.
  constraint search_rules_weight_shape check (
    action not in ('boost', 'bury') or weight <> 0
  ),
  constraint search_rules_bury_sign check (action <> 'bury' or weight < 0),
  constraint search_rules_boost_sign check (action <> 'boost' or weight > 0)
);

create index search_rules_lookup_idx on search_rules (query, match_type) where is_active;
create index search_rules_product_idx on search_rules (product_id);

alter table search_rules enable row level security;

/*
 * No public select policy. The rules are applied inside `search_products`, which is security definer —
 * a shopper sees the *effect* of a rule and never the rule, which is right: "why is this first" is
 * commercially sensitive once merchants are paying for placement.
 */
create policy p_write on search_rules for all
  using ((select has_any_role('{product_manager,content_manager}')))
  with check ((select has_any_role('{product_manager,content_manager}')));

create trigger set_updated_at before update on search_rules
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Redirects
-- -----------------------------------------------------------------------------

/**
 * Queries that should answer with a page rather than a product list.
 *
 * "transporti", "kthimi", "si te porosis" are real searches on a shop and every one of them returns zero
 * products today, which reads as "we don't do that" rather than "that's on the shipping page".
 *
 * `destination_path` is stored **unlocalised** (`/shipping`, not `/en/shipping`); the caller localises it,
 * so one row serves both locales and neither can be forgotten.
 */
create table search_redirects (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  match_type text not null default 'exact' check (match_type in ('exact', 'contains')),
  destination_path text not null check (destination_path ~ '^/'),
  is_active boolean not null default true,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index search_redirects_query_idx on search_redirects (query, match_type);

alter table search_redirects enable row level security;

-- Readable by anyone: the storefront fetches the whole (tiny) table once and matches in application code,
-- so a redirect costs no per-search query. Its contents are public by construction — every row is a
-- promise to send a visitor to a page that is already public.
create policy p_read on search_redirects for select using (is_active or (select is_staff()));
create policy p_write on search_redirects for all
  using ((select has_any_role('{product_manager,content_manager}')))
  with check ((select has_any_role('{product_manager,content_manager}')));

create trigger set_updated_at before update on search_redirects
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Normalisation on write
-- -----------------------------------------------------------------------------

/**
 * Both tables match against a normalised query, so both must *store* one.
 *
 * Doing this in a trigger rather than trusting the caller: the admin form is one caller, a future import
 * script is another, and a rule that silently never fires because someone saved "Vitamina C " with a
 * trailing space is the kind of bug that costs a week to notice.
 */
create or replace function public.normalize_search_rule_query() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  new.query := public.search_normalize(new.query);
  return new;
end $$;

create trigger normalize_query before insert or update of query on search_rules
  for each row execute function public.normalize_search_rule_query();
create trigger normalize_query before insert or update of query on search_redirects
  for each row execute function public.normalize_search_rule_query();

/*
 * `search_normalize` returns NULL for anything that normalises to nothing, and both tables reject that:
 * `search_redirects.query` is NOT NULL, and `search_rules_query_shape` requires a query whenever
 * `match_type` is not 'any'. So a rule saved as "   " fails at write time rather than becoming a row that
 * silently matches every search — which is the version of this bug that would be found by a customer.
 */
