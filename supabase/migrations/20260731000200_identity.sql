-- =============================================================================
-- 02 · Identity — profiles, role guard, addresses
-- Source: docs/03 §3, with the correction in docs/13 §A4.
-- =============================================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email extensions.citext not null,
  full_name text,
  phone text,
  role user_role not null default 'customer',
  avatar_url text,
  preferred_locale text not null default 'sq' check (preferred_locale in ('sq','en')),
  loyalty_points int not null default 0 check (loyalty_points >= 0),
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------------------------
-- Role helpers (docs/03 §2)
--
-- Declared here rather than in migration 01 because they are `language sql`, whose
-- body Postgres validates at CREATE time — they cannot be defined before `profiles`
-- exists. See the note in 20260731000100.
-- -----------------------------------------------------------------------------

/*
 * `security definer` so it can read `profiles` from inside a policy on `profiles`
 * itself without recursing — the function runs as the table owner, for whom RLS is
 * bypassed.
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

/** docs/03 §8 — a profile row is created for every auth user, by trigger, on signup. */
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/*
 * Role escalation guard.
 *
 * docs/13 §A4 — the original raised unless `has_any_role('{admin}')`, which resolves
 * through `auth.uid()`. Under the service role `auth.uid()` is NULL, so the check failed
 * and the trigger fired, breaking the two flows that legitimately need it:
 *   · admin team invite, which creates the auth user server-side (docs/06 §15)
 *   · the production bootstrap `update profiles set role='admin' …` (docs/11 §2)
 *
 * The service role is now exempted explicitly. A logged-in non-admin is still blocked,
 * which is the attack this guards against.
 */
create or replace function public.prevent_role_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not is_service_role()
     and not has_any_role(array['admin']::user_role[])
  then
    raise exception 'ROLE_CHANGE_FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_role_guard
  before update on profiles
  for each row execute function public.prevent_role_escalation();

/*
 * Loyalty points are ledger-derived (docs/07 §9). Only the trigger on
 * `loyalty_transactions` and the redeem RPC may move the balance — otherwise the
 * `p_self_update` policy would let a customer set their own points.
 */
create or replace function public.guard_profile_self_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.loyalty_points is distinct from old.loyalty_points
     and auth.uid() is not null
     and not is_service_role()
     and not has_any_role(array['admin','support']::user_role[])
  then
    raise exception 'LOYALTY_POINTS_NOT_DIRECTLY_WRITABLE' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_loyalty_guard
  before update on profiles
  for each row execute function public.guard_profile_self_update();

create table addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  label text,
  recipient_name text not null,
  phone text not null,
  line1 text not null,
  line2 text,
  city text not null,
  postal_code text,
  country_code char(2) not null default 'XK',
  is_default_shipping boolean not null default false,
  is_default_billing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/** At most one default of each kind per user; setting a new one clears the previous. */
create or replace function public.enforce_single_default_address() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.is_default_shipping then
    update addresses set is_default_shipping = false
    where user_id = new.user_id and id <> new.id and is_default_shipping;
  end if;
  if new.is_default_billing then
    update addresses set is_default_billing = false
    where user_id = new.user_id and id <> new.id and is_default_billing;
  end if;
  return null;
end $$;

create trigger addresses_single_default
  after insert or update of is_default_shipping, is_default_billing on addresses
  for each row execute function public.enforce_single_default_address();
