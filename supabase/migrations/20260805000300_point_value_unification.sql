-- =============================================================================
-- 54 · M13 · one point value: 1 point = €0.01, everywhere
-- Source: docs/17 §0.1.
-- =============================================================================

/*
 * ── The conflict ──
 *
 * Loyalty was defined as *earn 1 point per €1, redeem 100 points = €5* — a point worth 5 cents. The
 * referral programme assumes *100 points = €1* — a point worth 1 cent. One wallet cannot hold two
 * point values: the same integer in `profiles.loyalty_points` would mean two different amounts of
 * money depending on which feature put it there, and `referral_earnings.points` divides by the point
 * value to compute an award.
 *
 * Resolved as **1 point = €0.01**, which makes one sentence true of the whole programme: *everything
 * gives 1% back, and a point is a cent.* That survives translation into Albanian, which two conversion
 * rates do not.
 *
 * ── What this costs, stated plainly ──
 *
 * The old rule returned €5 for the 100 points earned on €100 of spend: **5% back**. The new rule
 * returns €1: **1% back**. This migration reduces the loyalty programme's value to customers by 80%.
 * That is a commercial decision, not a technical one, and it is recorded in docs/17 §0.1 rather than
 * left to be discovered by arithmetic. It is safe to do *now* only because nothing has launched and
 * no real points exist — every `loyalty_transactions` row belongs to a fixture.
 *
 * ── Renamed, not just revalued ──
 *
 * The old key names encode the old model, so keeping them would leave `redeem_points: 100` meaning
 * something else than it says:
 *
 *     earn_rate_points_per_eur  →  earn_points_per_eur
 *     redeem_points + redeem_value_cents  →  point_value_cents + min_redeem_points
 *
 * Both are read with `coalesce` over the old name as a fallback, so a project whose settings row has
 * not been migrated yet keeps working instead of silently earning zero.
 */

-- -----------------------------------------------------------------------------
-- Settings: the new shape, carrying over any customised earn rate.
-- -----------------------------------------------------------------------------
update settings
   set value = jsonb_build_object(
         'earn_points_per_eur', coalesce(
           (value->>'earn_points_per_eur')::numeric,
           (value->>'earn_rate_points_per_eur')::numeric,
           1
         ),
         'point_value_cents', coalesce((value->>'point_value_cents')::int, 1),
         'min_redeem_points', coalesce((value->>'min_redeem_points')::int, 500)
       )
 where key = 'loyalty';

-- -----------------------------------------------------------------------------
-- The earn trigger, restated for the new settings key — and **only** for that.
--
-- ── Copied verbatim from migration 37, two lines changed ──
--
-- My first attempt at this restatement was written from memory of migration 07 and was wrong in four
-- ways: it dropped the `is not distinct from` guard, wrote `type = 'received'` movements instead of
-- `cancel_restock` with a reference, restocked **every** line to the warehouse — reintroducing the
-- precise bug migration 37 exists to fix, inventing first-party stock for merchant lines — and lost
-- the block that cancels the order's fulfilments.
--
-- Caught by reading migration 37 before applying rather than after. That is the third time today that
-- `create or replace` on an accumulated function has gone wrong (docs/13 §X3, §X16), so the rule is
-- now explicit: **grep the function name across every migration, read them in order, copy the newest
-- text, then change the one thing.** Not "write it again from the spec".
--
-- The earn base is unchanged: `total_cents`, which includes shipping. Referral accrual uses
-- `subtotal − discount` instead (docs/17 §1). The asymmetry is deliberate — a customer earns on what
-- they paid, and a referrer is not paid a percentage of a courier fee.
-- -----------------------------------------------------------------------------
create or replace function public.orders_after_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_item record;
  v_warehouse uuid;
  v_earn int;
  v_rate numeric;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  insert into order_events (order_id, type, message, data, is_customer_visible)
  values (
    new.id, 'status_changed', old.status || ' → ' || new.status,
    jsonb_build_object('from', old.status, 'to', new.status), true
  );

  if new.status = 'delivered' then
    update payments set status = 'paid'
     where order_id = new.id and provider = 'cod' and status = 'pending';

    if new.user_id is not null then
      -- CHANGED: the new key, falling back to the old one so an unmigrated settings row still earns.
      select coalesce(
               (value->>'earn_points_per_eur')::numeric,
               (value->>'earn_rate_points_per_eur')::numeric,
               1
             )
        into v_rate from settings where key = 'loyalty';

      v_earn := floor((new.total_cents / 100.0) * coalesce(v_rate, 1));
      if v_earn > 0 then
        -- The ledger trigger moves profiles.loyalty_points; never touch it directly.
        insert into loyalty_transactions (user_id, points, reason, order_id)
        values (new.user_id, v_earn, 'earn_order', new.id);
      end if;
    end if;

  elsif new.status = 'cancelled' then
    select id into v_warehouse from warehouses where is_default limit 1;
    if v_warehouse is null then
      raise exception 'NO_DEFAULT_WAREHOUSE';
    end if;

    for v_item in
      select variant_id, quantity, merchant_offer_id from order_items
       where order_id = new.id and variant_id is not null
    loop
      if v_item.merchant_offer_id is null then
        update inventory_levels
           set on_hand = on_hand + v_item.quantity, updated_at = now()
         where variant_id = v_item.variant_id and warehouse_id = v_warehouse;

        insert into stock_movements
          (variant_id, warehouse_id, type, quantity, reference_type, reference_id)
        values
          (v_item.variant_id, v_warehouse, 'cancel_restock', v_item.quantity, 'order', new.id);
      else
        update merchant_offers
           set stock_on_hand = stock_on_hand + v_item.quantity, updated_at = now()
         where id = v_item.merchant_offer_id;
      end if;
    end loop;

    /*
     * Every fulfilment goes with it. A merchant seeing a cancelled order in its queue is the point:
     * without this, a merchant would keep packing a parcel for an order that no longer exists.
     */
    update order_fulfilments
       set status = 'cancelled',
           cancel_reason = coalesce(cancel_reason, 'Order cancelled')
     where order_id = new.id
       and status not in ('shipped', 'delivered', 'returned', 'cancelled');
  end if;

  return null;
end $$;

-- -----------------------------------------------------------------------------
-- Redemption becomes an amount the customer chooses.
--
-- The old function spent a fixed 100 points for a fixed €5 coupon. "Minimum 500 points" implies
-- choosing, so this takes an amount: a multiple of 100 points, at least `min_redeem_points`, worth
-- `points × point_value_cents`.
--
-- Multiples of 100 because €0.01 coupons are not a product anybody wants, and a minimum because a
-- shop drowning in 5-cent single-use coupons has a reconciliation problem rather than a loyalty
-- programme.
-- -----------------------------------------------------------------------------
create or replace function public.redeem_loyalty_points(p_points int default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_balance int;
  v_min int;
  v_point_value int;
  v_points int;
  v_value int;
  v_code text;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;

  select coalesce((value->>'min_redeem_points')::int, 500),
         coalesce((value->>'point_value_cents')::int, 1)
    into v_min, v_point_value
    from settings where key = 'loyalty';

  v_min := coalesce(v_min, 500);
  v_point_value := greatest(coalesce(v_point_value, 1), 1);

  -- Omitting the amount redeems the minimum, which is what the old fixed-tier callers expect.
  v_points := coalesce(p_points, v_min);

  if v_points < v_min then
    raise exception 'BELOW_MINIMUM:%', v_min;
  end if;
  if v_points % 100 <> 0 then
    raise exception 'NOT_A_MULTIPLE_OF_100';
  end if;

  -- Lock the profile so two concurrent redemptions cannot both pass the balance check.
  select loyalty_points into v_balance from profiles where id = v_user for update;
  if coalesce(v_balance, 0) < v_points then
    raise exception 'INSUFFICIENT_POINTS';
  end if;

  v_value := v_points * v_point_value;
  v_code := 'LOY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into coupons (
    code, type, value, max_uses, max_uses_per_user,
    starts_at, ends_at, is_active, is_system, note
  ) values (
    v_code::extensions.citext, 'fixed', v_value, 1, 1,
    now(), now() + interval '90 days', true, true,
    'Loyalty redemption for ' || v_user::text
  );

  insert into loyalty_transactions (user_id, points, reason, note)
  values (v_user, -v_points, 'redeem', 'Redeemed for coupon ' || v_code);

  return jsonb_build_object('code', v_code, 'value_cents', v_value, 'points_spent', v_points);
end $$;

revoke all on function public.redeem_loyalty_points(int) from public, anon;
grant execute on function public.redeem_loyalty_points(int) to authenticated;

/*
 * The old no-argument signature is dropped rather than left as an overload.
 *
 * Two functions differing only in arity make PostgREST's resolution depend on whether the caller sent
 * a body, which is the kind of ambiguity that works in testing and picks the wrong one in production.
 * The new signature defaults its argument, so an existing caller that sends nothing still works.
 */
drop function if exists public.redeem_loyalty_points();
