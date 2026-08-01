-- =============================================================================
-- 19 · Admin operations — customers, loyalty adjustment, GDPR, and three views
-- Source: docs/06 §8–§11, §15.
-- =============================================================================

/*
 * Three views and two RPCs. Nothing here adds a column: M10 is the milestone where the
 * remaining admin screens are built on the schema M1 already laid down, and a screen that
 * needs a new table is usually a screen that has misunderstood the schema.
 *
 * The views exist because the alternative is an N+1 from a React Server Component. "Customers
 * with their lifetime value" is one aggregate in SQL and one query per row in TypeScript, and
 * the second one is what makes an admin list take four seconds on a real customer base.
 */

-- -----------------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------------

/**
 * docs/06 §9 — the customer list: orders, lifetime value, points, joined.
 *
 * `security_invoker` so the reader's RLS still decides what they see: support reads every
 * profile (`p_self_read`), a customer reads only their own. The view is not a permission.
 *
 * Lifetime value counts what was actually kept — cancelled and refunded orders are excluded,
 * because an operator reading "€400 lifetime" next to a customer who returned everything is
 * being actively misled. `orders_count` follows the same rule for the same reason.
 */
drop view if exists v_admin_customers;
create view v_admin_customers with (security_invoker = on) as
  select
    p.id,
    p.email,
    p.full_name,
    p.phone,
    p.role,
    p.loyalty_points,
    p.marketing_opt_in,
    p.created_at,
    p.deleted_at,
    coalesce(o.orders_count, 0)      as orders_count,
    coalesce(o.lifetime_cents, 0)    as lifetime_cents,
    o.last_order_at,
    coalesce(s.active_subscriptions, 0) as active_subscriptions
  from profiles p
  left join (
    select user_id,
           count(*)          as orders_count,
           sum(total_cents)  as lifetime_cents,
           max(placed_at)    as last_order_at
      from orders
     where user_id is not null
       and status not in ('cancelled', 'refunded')
     group by user_id
  ) o on o.user_id = p.id
  left join (
    select user_id, count(*) as active_subscriptions
      from subscriptions
     where status = 'active'
     group by user_id
  ) s on s.user_id = p.id;

grant select on v_admin_customers to authenticated, service_role;

/**
 * docs/06 §8 — the stock table. `v_low_stock` answers "what is running out"; this answers
 * "what is there", which is a different screen and needs the rows that are fine too.
 *
 * The status bucket is computed here rather than in the component so the list can be filtered
 * and sorted by it in SQL. Three call sites deriving "low" from two integers is three chances
 * to use `<` where the view uses `<=`.
 */
drop view if exists v_admin_inventory;
create view v_admin_inventory with (security_invoker = on) as
  select
    il.variant_id,
    il.warehouse_id,
    w.name        as warehouse_name,
    pv.sku,
    pv.name       as variant_name,
    p.id          as product_id,
    p.name        as product_name,
    p.slug        as product_slug,
    p.status      as product_status,
    il.on_hand,
    il.low_stock_threshold,
    case
      when il.on_hand <= 0 then 'out'
      when il.on_hand <= il.low_stock_threshold then 'low'
      else 'ok'
    end as stock_status,
    il.updated_at
  from inventory_levels il
  join product_variants pv on pv.id = il.variant_id
  join warehouses w        on w.id  = il.warehouse_id
  join products p          on p.id  = pv.product_id
 where p.deleted_at is null;

grant select on v_admin_inventory to authenticated, service_role;

/**
 * docs/06 §11 — "list with usage stats (redemptions/max)".
 *
 * Redemptions are counted from `coupon_redemptions` rather than read from a counter column,
 * because there is no counter column and adding one would introduce the drift this project
 * has already fixed twice (stock, loyalty): a number that must be kept in step with rows is a
 * number that eventually is not.
 */
drop view if exists v_admin_coupons;
create view v_admin_coupons with (security_invoker = on) as
  select
    c.*,
    coalesce(r.redemption_count, 0) as redemption_count,
    r.last_redeemed_at
  from coupons c
  left join (
    select coupon_id,
           count(*)       as redemption_count,
           max(created_at) as last_redeemed_at
      from coupon_redemptions
     group by coupon_id
  ) r on r.coupon_id = c.id;

grant select on v_admin_coupons to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Loyalty adjustment (docs/06 §9)
-- -----------------------------------------------------------------------------

/**
 * A manual points adjustment, as a ledger row.
 *
 * `loyalty_transactions` has no insert policy (docs/13 §B5) — every writer is a security
 * definer function, so `profiles.loyalty_points` can only ever move through the balance
 * trigger and the ledger stays the source of truth. A support tool that wrote the balance
 * directly would be the one writer that breaks that.
 *
 * Refuses to take the balance below zero rather than clamping. `sync_loyalty_balance` uses
 * `greatest(0, …)`, so a clamp would silently write a ledger row whose effect on the balance
 * is smaller than the row says — the exact drift this design exists to prevent.
 */
create or replace function public.admin_adjust_loyalty(
  p_user_id uuid,
  p_points int,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_balance int;
begin
  if not has_any_role(array['admin','support']::user_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_points = 0 then
    raise exception 'ZERO_ADJUSTMENT' using errcode = '22023';
  end if;

  select loyalty_points into v_balance from profiles where id = p_user_id;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_balance + p_points < 0 then
    raise exception 'INSUFFICIENT_POINTS' using errcode = '23514';
  end if;

  insert into loyalty_transactions (user_id, points, reason, note, created_by)
  values (p_user_id, p_points, 'adjustment', nullif(trim(coalesce(p_note, '')), ''), auth.uid());

  select loyalty_points into v_balance from profiles where id = p_user_id;

  return jsonb_build_object('balance', v_balance, 'adjusted', p_points);
end $$;

revoke all on function public.admin_adjust_loyalty(uuid, int, text) from public, anon;
grant execute on function public.admin_adjust_loyalty(uuid, int, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- GDPR erasure (docs/06 §9)
-- -----------------------------------------------------------------------------

/**
 * Anonymise a customer: keep the commercial record, remove the person.
 *
 * docs/06 §9 says "keeps order rows, scrubs PII", and the two halves are both deliberate.
 * Deleting the orders would corrupt every revenue figure the business has already reported and
 * destroy records Kosovo tax law requires be retained; leaving the name and phone on them
 * would make the erasure cosmetic. So the rows stay and the identifying fields go.
 *
 * What is kept on an order: totals, dates, status, and the **city and country** of the
 * shipping address. That last one is a judgement — a city is not identifying on its own at any
 * plausible order volume, and shipping-region reporting is the one analysis that would
 * otherwise have to be run before every erasure.
 *
 * `auth.users` is *not* touched here. It is outside this function's schema, and a security
 * definer function reaching into GoTrue's tables is how you discover at 2am that a Supabase
 * upgrade changed one. The caller scrubs the auth identity through the admin API, which is why
 * `anonymizeCustomer` in `customers/actions.ts` is one of the listed service-role callers
 * (docs/02 §6).
 *
 * Admin only, and irreversible. The action confirms first.
 */
create or replace function public.admin_anonymize_customer(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_placeholder text := 'anonymised+' || replace(p_user_id::text, '-', '') || '@deleted.invalid';
  v_orders int;
  v_addresses int;
  v_role user_role;
begin
  if not has_any_role(array['admin']::user_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select role into v_role from profiles where id = p_user_id;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;

  /*
   * Staff are refused. Anonymising a colleague's profile would orphan every `audit_logs` row
   * they wrote — the trail would still name an actor id, but nobody could say who it was, and
   * an audit log you cannot resolve to a person is not an audit log. Deactivate them from the
   * team screen instead.
   */
  if v_role <> 'customer' then
    raise exception 'CANNOT_ANONYMISE_STAFF' using errcode = '42501';
  end if;

  update orders
     set email = v_placeholder,
         phone = '',
         customer_note = null,
         shipping_address = jsonb_strip_nulls(jsonb_build_object(
           'city', shipping_address->>'city',
           'country_code', shipping_address->>'country_code'
         )),
         billing_address = jsonb_strip_nulls(jsonb_build_object(
           'city', billing_address->>'city',
           'country_code', billing_address->>'country_code'
         ))
   where user_id = p_user_id;
  get diagnostics v_orders = row_count;

  delete from addresses where user_id = p_user_id;
  get diagnostics v_addresses = row_count;

  -- Marketing consent cannot survive erasure, and the subscriber row is keyed on the address.
  delete from newsletter_subscribers
   where email = (select email from profiles where id = p_user_id);

  -- Subscriptions carry a shipping address of their own and would keep shipping to it.
  update subscriptions
     set status = 'cancelled',
         cancelled_at = coalesce(cancelled_at, now()),
         cancel_reason = coalesce(cancel_reason, 'Customer data erased'),
         shipping_address = '{}'::jsonb
   where user_id = p_user_id
     and status <> 'cancelled';

  update profiles
     set email = v_placeholder,
         full_name = null,
         phone = null,
         avatar_url = null,
         marketing_opt_in = false,
         deleted_at = now()
   where id = p_user_id;

  return jsonb_build_object(
    'placeholder_email', v_placeholder,
    'orders_scrubbed', v_orders,
    'addresses_deleted', v_addresses
  );
end $$;

revoke all on function public.admin_anonymize_customer(uuid) from public, anon;
grant execute on function public.admin_anonymize_customer(uuid) to authenticated, service_role;
