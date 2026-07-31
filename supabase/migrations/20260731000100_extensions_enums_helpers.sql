-- =============================================================================
-- 01 · Extensions, enums, helper functions
-- Source: docs/03 §1–§2, with the corrections in docs/13 §A4, §A6, §B1, §B8.
-- =============================================================================

-- docs/13 §B8 — extensions live in their own schema, not `public`, where `anon` holds
-- usage. This is the Supabase linter's `extension_in_public` finding. Every reference to
-- a type, function or operator class from these extensions is schema-qualified.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create extension if not exists citext    with schema extensions;
create extension if not exists pg_trgm   with schema extensions;
create extension if not exists unaccent  with schema extensions;

-- -----------------------------------------------------------------------------
-- Enums (docs/03 §1)
-- -----------------------------------------------------------------------------
create type user_role as enum (
  'customer','support','product_manager','content_manager',
  'warehouse_manager','compliance_manager','admin'
);
create type product_status       as enum ('draft','pending_review','published','archived');
create type product_form         as enum ('capsule','tablet','softgel','powder','liquid','gummy','bar','spray','sachet','other');
create type evidence_level       as enum ('strong','moderate','emerging','traditional');
create type order_status         as enum ('pending','confirmed','processing','shipped','delivered','cancelled','refunded');
create type payment_status       as enum ('pending','paid','failed','refunded','partially_refunded');
create type payment_provider     as enum ('cod','bank_pos','stripe');
create type discount_type        as enum ('percentage','fixed','free_shipping');
create type review_status        as enum ('pending','approved','rejected');
create type article_status       as enum ('draft','in_review','published','archived');
create type article_type         as enum ('article','guide','recipe','research','news');
create type subscription_status  as enum ('active','paused','cancelled');
create type stock_movement_type  as enum ('received','sale','cancel_restock','refund_restock','adjustment');
create type cart_status          as enum ('active','converted','abandoned');

-- -----------------------------------------------------------------------------
-- Helpers (docs/03 §2)
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = public as
$$ begin new.updated_at := now(); return new; end $$;

/*
 * Role check. `security definer` so it can read `profiles` from inside a policy on
 * `profiles` itself without recursing — the function runs as the table owner, for whom
 * RLS is bypassed.
 *
 * Every caller in a policy wraps this as `(select has_any_role(...))` so the planner
 * hoists it into an InitPlan and evaluates it once per statement rather than once per
 * row (docs/13 §D7). On `orders` and `order_items` that is the difference between a
 * sub-millisecond scan and a per-row function call.
 */
create or replace function public.has_any_role(roles user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.deleted_at is null
      and (p.role = any(roles) or p.role = 'admin')
  );
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array[
    'support','product_manager','content_manager',
    'warehouse_manager','compliance_manager'
  ]::user_role[]);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array['admin']::user_role[]);
$$;

/** True when the current statement runs under the service role (cron, webhooks, seeds). */
create or replace function public.is_service_role() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role'
      or current_user = 'service_role';
$$;

-- -----------------------------------------------------------------------------
-- Identifiers
-- -----------------------------------------------------------------------------

create sequence if not exists order_number_seq;

/*
 * docs/13 §B1 — order numbers stay human-readable for operations but are no longer
 * guessable. `SH-2026-000123-K7QW`: the sequence keeps them sortable and speakable over
 * the phone, the four random hex characters mean walking the sequence yields nothing.
 *
 * This is defence in depth. The real gate on the success page is `orders.access_token`.
 */
create or replace function public.generate_order_number() returns text
language sql volatile set search_path = public as $$
  select 'SH-' || to_char(now(), 'YYYY') || '-'
      || lpad(nextval('order_number_seq')::text, 6, '0') || '-'
      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
$$;

/** 256 bits of entropy as hex. `gen_random_uuid()` is core in PG13+, so no pgcrypto. */
create or replace function public.generate_access_token() returns text
language sql volatile set search_path = public as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

-- -----------------------------------------------------------------------------
-- Rate limiter (docs/03 §8, corrected per docs/13 §A6)
-- -----------------------------------------------------------------------------

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (key, window_start)
);
alter table rate_limits enable row level security;
-- No policies: reachable only through the security-definer RPC below.

/*
 * docs/13 §A6 — the original bucketed on `extract(minute from now()) % window_minutes`.
 * `extract(minute …)` only returns 0–59, so for any window of an hour or more the modulo
 * is a no-op and the bucket silently collapses to the current hour: the specified
 * "5 reviews per day" limit was enforcing 5 per hour.
 *
 * Bucketing on absolute epoch is correct for every window length.
 */
create or replace function public.check_rate_limit(p_key text, p_max int, p_window interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_window_seconds numeric := greatest(1, extract(epoch from p_window));
  v_bucket timestamptz := to_timestamp(
    floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds
  );
  v_count int;
begin
  insert into rate_limits (key, window_start, count)
  values (p_key, v_bucket, 1)
  on conflict (key, window_start) do update set count = rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_max;
end $$;

revoke all on function public.check_rate_limit(text, int, interval) from public;
grant execute on function public.check_rate_limit(text, int, interval) to anon, authenticated, service_role;
