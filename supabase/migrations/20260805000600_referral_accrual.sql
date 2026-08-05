-- =============================================================================
-- M13 step 4 · The accrual engine (docs/17 §1 rate/caps/clawback, §3)
--
-- One function, `accrue_referral_for_order`, called from two places: the delivered branch of
-- `orders_after_status_change`, and `refunds_after_insert`. It is idempotent by construction — the
-- unique `(order_id, reason)` on `referral_earnings` is the guarantee, not a check-then-insert.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Two new ledger reasons, and why they cannot be folded into the existing ones.
--
-- `earn_order` is out: `refunds_after_insert` claws back by summing `earn_order` rows for the refunded
-- order, so a referral row wearing that reason would be treated as the *referred customer's* own
-- points and deducted from the wrong person. `adjustment` is out because it means "a human moved this
-- by hand", and a ledger that cannot distinguish an automated award from a manual correction cannot be
-- audited.
-- -----------------------------------------------------------------------------
alter table loyalty_transactions drop constraint if exists loyalty_transactions_reason_check;
alter table loyalty_transactions add constraint loyalty_transactions_reason_check
  check (reason in (
    'earn_order', 'redeem', 'adjustment', 'expiry', 'clawback',
    'referral', 'referral_clawback'
  ));

comment on column loyalty_transactions.order_id is
  'The order that caused the movement, when the owner of these points placed it. Deliberately null on
   referral rows: see docs/17 §0.2 — an order id on a referrer''s ledger row would date a referred
   customer''s shopping. The order lives on `referral_earnings`, which no customer can read.';

-- -----------------------------------------------------------------------------
-- The engine.
--
-- Returns the points it awarded (signed, so a clawback returns a negative), or 0 when nothing was due.
-- Like `link_referral`, it returns rather than raises: it is called from `orders_after_status_change`,
-- and an exception there would roll back the *delivery* of an order. A referral that fails to accrue is
-- repairable; an order that cannot be marked delivered stops the warehouse.
-- -----------------------------------------------------------------------------
create or replace function public.accrue_referral_for_order(
  p_order_id uuid,
  p_reason text default 'delivered'
) returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg jsonb;
  v_order orders%rowtype;
  v_link referral_links%rowtype;
  v_base int;
  v_points int;
  v_rate numeric;
  v_point_value int;
  v_min_order int;
  v_cap int;
  v_awarded int;
  v_remaining int;
  v_earned int;
  v_refunded int;
  v_share numeric;
  v_already int;
  v_delta int;
  v_balance int;
  v_post int;
  v_tx uuid;
  v_earning uuid;
  v_mode text;
begin
  if p_reason not in ('delivered', 'refund') then
    return 0;
  end if;

  select value into v_cfg from settings where key = 'referral';
  if coalesce((v_cfg->>'enabled')::boolean, false) is not true then
    return 0;
  end if;

  select * into v_order from orders where id = p_order_id;
  if not found or v_order.user_id is null then
    -- No account, no link. A guest order accrues nothing, ever (docs/17 §3).
    return 0;
  end if;

  /*
   * Only an `approved` link accrues, and revocation is immediate (§1): a revoked link keeps the points
   * it has already been paid and earns nothing further, which falls out of this line rather than
   * needing its own branch.
   */
  select * into v_link
    from referral_links
   where referee_id = v_order.user_id
     and status = 'approved';
  if not found then
    return 0;
  end if;

  select coalesce((value->>'point_value_cents')::int, 1)
    into v_point_value from settings where key = 'loyalty';
  v_point_value := greatest(coalesce(v_point_value, 1), 1);

  v_rate := coalesce((v_cfg->>'rate_pct')::numeric, 1.00);
  v_min_order := coalesce((v_cfg->>'min_order_cents_to_count')::int, 1000);
  v_cap := (v_cfg->>'max_points_per_link_per_year')::int;
  v_mode := coalesce(v_cfg->>'accrual_mode', 'monthly');

  -- ══ The clawback path ═══════════════════════════════════════════════════════════════════════════
  if p_reason = 'refund' then
    /*
     * Proportional to what was refunded, computed as "what should still be owed" rather than as a
     * percentage to subtract — so a sequence of partial refunds converges on the right total instead of
     * accumulating rounding error, and a full refund necessarily returns everything.
     */
    select coalesce(sum(points), 0) into v_earned
      from referral_earnings where order_id = p_order_id and reason = 'delivered';
    if v_earned <= 0 then
      return 0;
    end if;

    select coalesce(sum(amount_cents), 0) into v_refunded
      from refunds where order_id = p_order_id;

    v_share := least(1.0, v_refunded::numeric / greatest(v_order.total_cents, 1));

    /*
     * `v_points` is the **cumulative** clawback, and `v_delta` is what is new about it.
     *
     * There is one `refund` row per order — `unique (order_id, reason)` — so a second partial refund
     * cannot add a second row. Written naively with `on conflict do nothing`, the second refund would
     * therefore take back nothing at all: the shop would refund €50 of a €100 order twice and reclaim
     * only the first half's points. So the row holds the running total, and only the difference is
     * posted to the wallet.
     */
    select coalesce(-points, 0) into v_already
      from referral_earnings where order_id = p_order_id and reason = 'refund';
    v_already := coalesce(v_already, 0);

    v_points := -(v_earned - floor(v_earned * (1 - v_share))::int);
    v_delta := v_points + v_already;
    if v_delta >= 0 then
      -- Nothing new to reclaim. A repeated call, or a refund that rounds to no points.
      return 0;
    end if;

  -- ══ The earning path ════════════════════════════════════════════════════════════════════════════
  else
    /*
     * The clock stops at twelve months, measured on delivery (§1). `delivered_at` is set by the BEFORE
     * trigger, so it is populated by the time this runs; `now()` is the fallback for a direct call.
     */
    if coalesce(v_order.delivered_at, now()) > v_link.expires_at then
      return 0;
    end if;

    /*
     * Eligible spend excludes shipping (§1). A referrer is not paid a percentage of a courier fee — and
     * the customer's own loyalty earn deliberately uses `total_cents` instead, because a customer earns
     * on what they actually paid. The asymmetry is intentional and is noted in migration 54.
     */
    v_base := greatest(v_order.subtotal_cents - v_order.discount_cents, 0);
    if v_base < v_min_order then
      return 0;
    end if;

    v_points := floor(v_base * v_rate / 100.0 / v_point_value)::int;
    if v_points <= 0 then
      return 0;
    end if;

    /*
     * The cap pays up to the limit and then flags, rather than dropping the overflow silently (§1).
     * Both halves matter: paying the first part is what the referrer earned, and the flag is what puts
     * the link in front of a human — a referral that reaches €200 in twelve months is either a very
     * good advocate or a farm, and only a person can tell.
     */
    if v_cap is not null then
      select coalesce(sum(points), 0) into v_awarded
        from referral_earnings where link_id = v_link.id;

      v_remaining := greatest(v_cap - v_awarded, 0);
      if v_points > v_remaining then
        update referral_links
           set risk_flags = (
                 select array_agg(distinct flag)
                   from unnest(risk_flags || array['cap_reached']) as flag
               )
         where id = v_link.id;

        v_points := v_remaining;
        if v_points <= 0 then
          return 0;
        end if;
      end if;
    end if;
  end if;

  -- ══ The earning row decides whether anything happened ═══════════════════════════════════════════
  /*
   * Written **before** the wallet moves, and the unique `(order_id, reason)` is what makes the whole
   * function idempotent — not a preceding `if exists` check.
   *
   * The difference matters under concurrency. An order delivered twice in the same instant, or a trigger
   * that fires twice, would both pass a check-then-insert and post the points twice before either
   * insert failed. Here the insert is the decision: whichever call loses the conflict gets no row back,
   * returns 0, and never touches the ledger. The first version of this function posted the points first
   * and deleted them again on conflict, which is the same race with extra steps.
   *
   * `delivered` never overwrites: one order earns once. `refund` updates in place, because there is one
   * refund row per order carrying the running total, and only when the total actually moved.
   */
  insert into referral_earnings (link_id, order_id, base_cents, points, reason)
  values (
    v_link.id,
    p_order_id,
    case when p_reason = 'refund' then -coalesce(v_refunded, 0) else v_base end,
    v_points,
    p_reason
  )
  on conflict (order_id, reason) do update
     set points = excluded.points,
         base_cents = excluded.base_cents
   where referral_earnings.reason = 'refund'
     and referral_earnings.points <> excluded.points
  returning id into v_earning;

  if v_earning is null then
    return 0;
  end if;

  -- ══ Posting ═════════════════════════════════════════════════════════════════════════════════════
  /*
   * `immediate` moves the wallet now; `monthly` (the default) leaves `loyalty_transaction_id` null for
   * the cron to sweep. The privacy reason is docs/17 §0.2: one ledger row per referred order is a
   * timestamped list of when that customer shopped, visible to the referrer. One aggregated row a month
   * is not.
   *
   * A clawback posts only if the earning it reverses was posted. Under `monthly`, a refund before the
   * first of the month simply nets against the unposted positive and the wallet never moves — which is
   * both correct and kinder than paying points and taking them back.
   */
  if v_mode = 'immediate'
     or (p_reason = 'refund' and exists (
           select 1 from referral_earnings
            where order_id = p_order_id
              and reason = 'delivered'
              and loyalty_transaction_id is not null
         ))
  then
    -- On a clawback only the *new* part is posted; the row above already holds the running total.
    v_post := case when p_reason = 'refund' then v_delta else v_points end;

    /*
     * Floored to the balance, because `sync_loyalty_balance` clamps at zero: inserting -100 against a
     * balance of 50 would leave the balance at 0 and the ledger summing to -50, and a ledger that does
     * not equal the balance is worse than an under-recovered clawback. The unrecovered part stays
     * visible as the gap between `sum(referral_earnings.points)` and what was posted — which is what
     * §1 means by the shortfall being recorded and netted against future accrual.
     */
    if v_post < 0 then
      select loyalty_points into v_balance from profiles where id = v_link.referrer_id for update;
      v_post := -least(-v_post, coalesce(v_balance, 0));
    end if;

    if v_post <> 0 then
      insert into loyalty_transactions (user_id, points, reason, note)
      values (
        v_link.referrer_id,
        v_post,
        case when v_post < 0 then 'referral_clawback' else 'referral' end,
        case when v_post < 0 then 'Referral adjustment' else 'Referral reward' end
      )
      returning id into v_tx;

      /*
       * The pointer records that this earning has been settled, which is what keeps the monthly sweep
       * from paying it again. On an order refunded in instalments it names the most recent posting; the
       * complete history is `loyalty_transactions` itself, which is append-only.
       */
      update referral_earnings set loyalty_transaction_id = v_tx where id = v_earning;
    end if;
  end if;

  return case when p_reason = 'refund' then v_delta else v_points end;
end $$;

comment on function public.accrue_referral_for_order is
  'Awards or claws back referral points for one order. Idempotent per (order, reason). docs/17 §3.';

revoke all on function public.accrue_referral_for_order(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- The delivered hook.
--
-- Restated in full from migration 54, which was itself copied verbatim from migration 37, with one
-- statement added. docs/13 §X3: a `create or replace` is the whole definition, so the whole definition
-- has to be in the file a reader is looking at — and this function has now gone wrong three times when
-- it was rewritten from the spec instead of copied from the newest text.
--
-- `grep orders_after_status_change supabase/migrations/` → 20260731000700, 20260803001200, 20260805000300.
-- Read in that order; this is 20260805000300 plus the accrual call.
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

      /*
       * ADDED (docs/17 §3): the referrer's cut, after the customer's own earn.
       *
       * After, because the order of the two ledger rows is what an admin reads top to bottom, and
       * because the referral award is a consequence of the order having been earned on — not a
       * competitor for it. It returns rather than raises, so a referral problem cannot stop a delivery.
       */
      perform public.accrue_referral_for_order(new.id, 'delivered');
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
-- The refund hook.
--
-- Restated in full from migration 07, the only migration that has ever defined it
-- (`grep refunds_after_insert supabase/migrations/`), with one statement added.
-- -----------------------------------------------------------------------------
create or replace function public.refunds_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_refunded_total int;
  v_earned int;
  v_balance int;
  v_clawback int;
begin
  select * into v_order from orders where id = new.order_id;

  select coalesce(sum(amount_cents), 0) into v_refunded_total
    from refunds where order_id = new.order_id;

  if v_refunded_total > v_order.total_cents then
    raise exception 'REFUND_EXCEEDS_PAID_TOTAL' using errcode = '23514';
  end if;

  if v_refunded_total >= v_order.total_cents then
    update payments set status = 'refunded' where order_id = new.order_id;
    update orders set payment_status = 'refunded' where id = new.order_id;
  else
    update payments set status = 'partially_refunded' where order_id = new.order_id;
    update orders set payment_status = 'partially_refunded' where id = new.order_id;
  end if;

  -- Claw back points earned on this order, never below the customer's balance.
  if v_order.user_id is not null then
    select coalesce(sum(points), 0) into v_earned
      from loyalty_transactions
     where order_id = new.order_id and reason = 'earn_order';

    if v_earned > 0 then
      select loyalty_points into v_balance from profiles where id = v_order.user_id;
      v_clawback := least(v_earned, coalesce(v_balance, 0));

      if v_clawback > 0 then
        insert into loyalty_transactions (user_id, points, reason, order_id, note)
        values (v_order.user_id, -v_clawback, 'clawback', new.order_id,
                'Refund of order ' || v_order.order_number);
      end if;
    end if;
  end if;

  /*
   * ADDED (docs/17 §1): and the referrer's cut goes back too.
   *
   * Outside the `user_id is not null` block above only in appearance — the engine checks it itself and
   * returns 0 for a guest order. Called on every refund row, because a second partial refund has to
   * take back more, and the engine recomputes from the refunded total rather than from this row.
   */
  perform public.accrue_referral_for_order(new.order_id, 'refund');

  insert into order_events (order_id, type, message, data, is_customer_visible)
  values (new.order_id, 'refund', 'Refund issued',
          jsonb_build_object('amount_cents', new.amount_cents, 'reason', new.reason), true);

  return null;
end $$;
