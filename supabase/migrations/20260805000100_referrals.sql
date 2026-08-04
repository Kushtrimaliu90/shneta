-- =============================================================================
-- 52 · M13 · the referral programme: codes, links, earnings
-- Source: docs/17 §1, §2, §6.
-- =============================================================================

create type referral_link_status as enum ('pending', 'approved', 'rejected', 'revoked', 'expired');

-- -----------------------------------------------------------------------------
-- The code.
--
-- `BIO-` + 5 characters from an alphabet with no I, O, 0 or 1 — because this code is read aloud in a
-- shop, written on a receipt and typed by somebody who has just been handed a phone. `citext` so
-- `bio-k7f2m` works: a case-sensitive referral code is a support ticket.
--
-- 32^5 = 33.5 million combinations. At 100,000 customers the chance of a collision on any single
-- generated code is about 0.3%, which is why the generator retries rather than assuming.
-- -----------------------------------------------------------------------------
alter table profiles add column if not exists referral_code extensions.citext unique;

comment on column profiles.referral_code is
  'Permanent invite code, BIO-XXXXX from an unambiguous alphabet. Immutable. docs/17 §1.';

create or replace function public.generate_referral_code() returns extensions.citext
language plpgsql
-- `citext` lives in the `extensions` schema on Supabase; without this the return type does not resolve
-- inside the function body's own search path (docs/13 §X2 is the same trap in a `returns table`).
set search_path = public, extensions
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_attempt int := 0;
begin
  /*
   * Bounded retry, and the bound matters. An unbounded loop against a unique index is a request that
   * never returns once the space fills up; twelve attempts against 33.5 million combinations means
   * something is wrong with the assumption, not with this draw, and raising says so.
   */
  loop
    v_code := 'BIO-';
    for i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    exit when not exists (select 1 from profiles where referral_code = v_code::extensions.citext);

    v_attempt := v_attempt + 1;
    if v_attempt >= 12 then
      raise exception 'REFERRAL_CODE_EXHAUSTED after % attempts', v_attempt;
    end if;
  end loop;

  return v_code::extensions.citext;
end $$;

comment on function public.generate_referral_code is
  'A free BIO-XXXXX code, retrying on collision. docs/17 §1.';

-- Every existing profile gets one, oldest first so the codes are not correlated with anything.
do $$
declare v_id uuid;
begin
  for v_id in select id from profiles where referral_code is null order by created_at loop
    update profiles set referral_code = public.generate_referral_code() where id = v_id;
  end loop;
end $$;

/*
 * And going forward, in the trigger that already creates the profile.
 *
 * Restated in full rather than patched: `handle_new_user` is two statements and restating it here
 * keeps the whole definition in one place a reader can check — the alternative is the §X3 trap, where
 * a function's real behaviour is the accumulation of migrations nobody reads together.
 *
 * The code is generated **inside** the insert rather than by a separate update, so a profile never
 * exists without one — anything reading `referral_code` can treat it as not-null in practice even
 * though the column allows null for the backfill's sake.
 */
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, referral_code)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), ''),
    public.generate_referral_code()
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- The link. One row per referred customer, for ever.
-- -----------------------------------------------------------------------------
create table referral_links (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references profiles(id) on delete cascade,
  referee_id uuid not null references profiles(id) on delete cascade,
  status referral_link_status not null default 'pending',
  source text not null default 'signup' check (source in ('signup', 'link', 'account', 'admin')),
  code_used extensions.citext,

  /*
   * `linked_at` is the **approval** time, not the signup time, and `expires_at` derives from it.
   *
   * Starting the clock at signup would spend part of the twelve months in a review queue, which is
   * BioCode's delay to own rather than the referrer's to lose. An admin creating a link by hand may
   * backdate it deliberately (docs/17 §5), which is why this is a column and not an expression.
   */
  linked_at timestamptz,
  expires_at timestamptz,

  approved_by uuid references profiles(id),
  revoked_by uuid references profiles(id),
  revoked_at timestamptz,
  revoke_reason text,

  /** 'same_ip' · 'same_phone' · 'same_address' · 'rapid_signup' · 'cap_reached' */
  risk_flags text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The one-referrer-per-customer rule, enforced by the database rather than by a check in an action.
  unique (referee_id),
  check (referrer_id <> referee_id),

  /*
   * An approved link always has both timestamps.
   *
   * Written as an implication the long way round — "not approved, or both present" — because the
   * clever form (`(status = 'approved') <= (…)`, boolean implication in Postgres) is correct and
   * unreadable, and a constraint nobody can read is one somebody drops.
   *
   * `revoked` and `expired` links were approved once, so they keep their timestamps; only `pending`
   * and `rejected` may have none.
   */
  check (status <> 'approved' or (linked_at is not null and expires_at is not null))
);

create index referral_links_referrer_idx on referral_links (referrer_id, status);
create index referral_links_expiry_idx on referral_links (status, expires_at);
create index referral_links_code_idx on referral_links (code_used);

create trigger referral_links_updated_at
  before update on referral_links
  for each row execute function public.set_updated_at();

comment on table referral_links is
  'One referrer per referred customer, for ever. docs/17 §1.';

-- -----------------------------------------------------------------------------
-- The earnings ledger.
--
-- Append-only in spirit, like `loyalty_transactions` and `merchant_ledger`: a correction is another
-- row with `reason = 'adjustment'`, never an edit. `unique (order_id, reason)` is what makes the
-- accrual idempotent — an order delivered twice, or a trigger that fires twice, produces one earning.
-- -----------------------------------------------------------------------------
create table referral_earnings (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references referral_links(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  base_cents int not null,
  /** Signed: negative on clawback. */
  points int not null,
  reason text not null default 'delivered' check (reason in ('delivered', 'refund', 'adjustment')),

  /*
   * Null until the points are posted to the wallet.
   *
   * With `accrual_mode = monthly` the earning exists the moment the order is delivered — so admin can
   * see it — but the wallet moves once a month in one aggregated row, which is what stops the ledger
   * from being a timestamped list of when a referred customer shopped (docs/17 §0.2).
   */
  loyalty_transaction_id uuid references loyalty_transactions(id),

  created_at timestamptz not null default now(),

  unique (order_id, reason)
);

create index referral_earnings_link_idx on referral_earnings (link_id, created_at);
-- The monthly posting sweep: unposted rows, oldest first.
create index referral_earnings_unposted_idx on referral_earnings (created_at)
  where loyalty_transaction_id is null;

comment on table referral_earnings is
  'One accrual per order per reason. Append-only; corrections are new rows. docs/17 §1, §3.';

-- =============================================================================
-- RLS (docs/17 §6)
-- =============================================================================

alter table referral_links enable row level security;
alter table referral_earnings enable row level security;

/*
 * ── The referee may read its own single row ──
 *
 * So the account page can say "you joined with a friend's code" and link to the terms. It exposes
 * `referrer_id`, which is a profile id and not a name — the UI resolves the display name through the
 * RPC, which returns a first name and an initial.
 */
-- `(select auth.uid())` so it is hoisted to an InitPlan and evaluated once, not per row (docs/13 §D7).
create policy p_referee_read on referral_links for select
  using (referee_id = (select auth.uid()));

/*
 * ── The referrer may **not** select its own links directly ──
 *
 * Deliberately absent, and the most important line in this file. A referrer reading
 * `referral_links` would get `referee_id`, which joins to `profiles`, `orders` and everything else a
 * referred customer has done. The customer-facing read path is `my_referral_overview()`, security
 * definer, which returns masked labels and aggregates and nothing that identifies a person.
 *
 * The isolation test asserts this in both directions: the RPC returns rows, and a direct select
 * returns none.
 */

create policy p_staff_read on referral_links for select
  using ((select is_staff()));

create policy p_admin_write on referral_links for all
  using ((select has_any_role('{admin,support}')))
  with check ((select has_any_role('{admin,support}')));

/*
 * ── `referral_earnings` has no customer policy at all ──
 *
 * Not a narrow one: none. Every row is an amount attributable to one referred customer's one order,
 * which is exactly the fact docs/17 §0.2 exists to protect. Staff read it; the accrual engine writes
 * it as the service role; a customer never touches it, and there is no join for a future feature to
 * reach through.
 */
create policy p_staff_read on referral_earnings for select
  using ((select is_staff()));

create policy p_admin_write on referral_earnings for all
  using ((select has_any_role('{admin}')))
  with check ((select has_any_role('{admin}')));

-- =============================================================================
-- Settings
-- =============================================================================

insert into settings (key, value) values
 ('referral', '{"enabled": true, "rate_pct": 1.00, "duration_months": 12, "auto_approve": false,
   "accrual_mode": "monthly", "min_order_cents_to_count": 1000,
   "max_points_per_link_per_year": 20000, "max_referrals_per_customer": null,
   "grace": "until_first_order"}'::jsonb)
on conflict (key) do nothing;
