-- =============================================================================
-- 07 · Triggers and derived state
-- Source: docs/03 §8, with the corrections in docs/13 §A2, §A5, §B6, §D3, §D4.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- updated_at, everywhere the column exists
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public'
       and c.column_name = 'updated_at'
       -- Views also expose columns; only base tables can carry a trigger.
       and tb.table_type = 'BASE TABLE'
  loop
    if not exists (
      select 1 from pg_trigger
       where tgname = 'set_updated_at' and tgrelid = format('public.%I', t)::regclass
    ) then
      execute format(
        'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Product search vector (docs/03 §8)
-- -----------------------------------------------------------------------------

/**
 * Albanian has no built-in text search configuration, so `simple` + `unaccent` is the
 * approach: it folds ë/ç and leaves stemming to the trigram index for typo tolerance.
 */
create or replace function public.products_set_search() returns trigger
language plpgsql set search_path = public, extensions as $$
declare v_brand text;
begin
  select name into v_brand from brands where id = new.brand_id;

  new.search_text := to_tsvector('simple', extensions.unaccent(
    coalesce(new.name->>'sq', '')     || ' ' || coalesce(new.name->>'en', '')     || ' ' ||
    coalesce(new.subtitle->>'sq', '') || ' ' || coalesce(new.subtitle->>'en', '') || ' ' ||
    array_to_string(new.dietary_tags, ' ') || ' ' || coalesce(v_brand, '')
  ));
  return new;
end $$;

create trigger products_search
  before insert or update of name, subtitle, dietary_tags, brand_id on products
  for each row execute function public.products_set_search();

-- -----------------------------------------------------------------------------
-- Review aggregates
-- -----------------------------------------------------------------------------

/*
 * docs/13 §A2 — the original read `coalesce(new.product_id, old.product_id)` in a trigger
 * declared `after insert or update … or delete`.
 *
 * In PL/pgSQL, NEW is *unassigned* during DELETE (and OLD during INSERT); touching a
 * field raises `record "new" is not assigned yet`. Deleting a review therefore failed
 * outright, and the INSERT path only survived if COALESCE happened to short-circuit
 * before the second parameter was fetched. Branching on TG_OP is unambiguous.
 */
create or replace function public.refresh_product_rating() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_product_id uuid;
begin
  v_product_id := case when tg_op = 'DELETE' then old.product_id else new.product_id end;

  update products p
     set rating_avg = coalesce((
           select round(avg(rating)::numeric, 2) from reviews
            where product_id = v_product_id and status = 'approved'), 0),
         rating_count = (
           select count(*) from reviews
            where product_id = v_product_id and status = 'approved')
   where p.id = v_product_id;

  return null;
end $$;

create trigger reviews_rating
  after insert or update of status, rating or delete on reviews
  for each row execute function public.refresh_product_rating();

/*
 * docs/13 §D3 — `reviews.helpful_count` had no writer. `review_votes` is the source of
 * truth; the counter is a denormalisation and must be maintained, not hand-edited.
 */
create or replace function public.refresh_review_helpful_count() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_review_id uuid;
begin
  v_review_id := case when tg_op = 'DELETE' then old.review_id else new.review_id end;

  update reviews r
     set helpful_count = (select count(*) from review_votes where review_id = v_review_id)
   where r.id = v_review_id;

  return null;
end $$;

create trigger review_votes_count
  after insert or delete on review_votes
  for each row execute function public.refresh_review_helpful_count();

-- -----------------------------------------------------------------------------
-- Loyalty balance is ledger-derived
-- -----------------------------------------------------------------------------

/**
 * `profiles.loyalty_points` mirrors the sum of `loyalty_transactions`. Every writer
 * inserts a ledger row and the balance follows, so earn, redeem, manual adjustment and
 * refund clawback cannot drift apart.
 *
 * The transaction-local flag is what lets this pass `profiles_loyalty_guard`, which
 * otherwise blocks any non-staff write to the balance.
 */
create or replace function public.sync_loyalty_balance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('biocode.loyalty_sync', 'on', true);

  update profiles
     set loyalty_points = greatest(0, loyalty_points + new.points)
   where id = new.user_id;

  perform set_config('biocode.loyalty_sync', 'off', true);
  return null;
end $$;

create trigger loyalty_balance_sync
  after insert on loyalty_transactions
  for each row execute function public.sync_loyalty_balance();

create or replace function public.guard_profile_self_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.loyalty_points is distinct from old.loyalty_points
     and coalesce(current_setting('biocode.loyalty_sync', true), 'off') <> 'on'
     and auth.uid() is not null
     and not is_service_role()
     and not has_any_role(array['admin','support']::user_role[])
  then
    raise exception 'LOYALTY_POINTS_NOT_DIRECTLY_WRITABLE' using errcode = '42501';
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Order integrity and lifecycle
-- -----------------------------------------------------------------------------

/*
 * docs/13 §B6 — `p_staff_update on orders for update using (has_any_role(...))` lets
 * support rewrite `total_cents`, `coupon_id` or `user_id` on a placed order. RLS cannot
 * express column-level rules, so the constraint lives here.
 *
 * Money is written exactly once, by the checkout RPC.
 */
create or replace function public.guard_order_immutable_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_service_role() or auth.uid() is null or has_any_role(array['admin']::user_role[]) then
    return new;
  end if;

  if new.order_number   is distinct from old.order_number
  or new.access_token   is distinct from old.access_token
  or new.user_id        is distinct from old.user_id
  or new.subtotal_cents is distinct from old.subtotal_cents
  or new.discount_cents is distinct from old.discount_cents
  or new.shipping_cents is distinct from old.shipping_cents
  or new.tax_cents      is distinct from old.tax_cents
  or new.total_cents    is distinct from old.total_cents
  or new.coupon_id      is distinct from old.coupon_id
  or new.placed_at      is distinct from old.placed_at
  then
    raise exception 'ORDER_FIELD_IMMUTABLE' using errcode = '42501';
  end if;

  return new;
end $$;

create trigger orders_immutable_guard
  before update on orders
  for each row execute function public.guard_order_immutable_columns();

/*
 * State machine (docs/07 §7.1).
 *
 * docs/13 §A5 — this trigger is `security definer` on purpose. It reads `payments` to
 * decide whether a COD order becomes `paid` on delivery; as an invoker-rights trigger
 * that read ran under the caller's RLS, and the `payments` select policy grants `support`
 * but not `warehouse_manager`. A warehouse manager marking an order delivered therefore
 * left `orders.payment_status` at `pending` while the after-trigger still flipped
 * `payments.status` to `paid` — the two disagreed depending on who clicked the button.
 */
create or replace function public.orders_before_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending'    and new.status in ('confirmed','cancelled')) or
      (old.status = 'confirmed'  and new.status in ('processing','cancelled')) or
      (old.status = 'processing' and new.status in ('shipped','cancelled'))   or
      (old.status = 'shipped'    and new.status in ('delivered','refunded'))  or
      (old.status = 'delivered'  and new.status in ('refunded'))
    ) then
      raise exception 'INVALID_STATUS_TRANSITION:%->%', old.status, new.status
        using errcode = '23514';
    end if;

    if new.status = 'delivered' then
      new.delivered_at := now();
      if exists (
        select 1 from payments
         where order_id = new.id and provider = 'cod' and status = 'pending'
      ) then
        new.payment_status := 'paid';
      end if;
    elsif new.status = 'cancelled' then
      new.cancelled_at := now();
    end if;
  end if;

  return new;
end $$;

create trigger orders_status_guard
  before update on orders
  for each row execute function public.orders_before_status_change();

/** Side effects (docs/07 §7.2): event log, COD settlement, loyalty earn, restock. */
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
      select coalesce((value->>'earn_rate_points_per_eur')::numeric, 1)
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
      select variant_id, quantity from order_items
       where order_id = new.id and variant_id is not null
    loop
      update inventory_levels
         set on_hand = on_hand + v_item.quantity, updated_at = now()
       where variant_id = v_item.variant_id and warehouse_id = v_warehouse;

      insert into stock_movements
        (variant_id, warehouse_id, type, quantity, reference_type, reference_id)
      values
        (v_item.variant_id, v_warehouse, 'cancel_restock', v_item.quantity, 'order', new.id);
    end loop;
  end if;

  return null;
end $$;

create trigger orders_status_effects
  after update on orders
  for each row execute function public.orders_after_status_change();

-- -----------------------------------------------------------------------------
-- Refunds
-- -----------------------------------------------------------------------------

/*
 * docs/13 §D4 — docs/07 §9 requires loyalty earned on a refunded order to be clawed back
 * "floored to the available balance", but nothing implemented it.
 *
 * Also enforces the cap from docs/07 §7.3: refunds may never exceed the amount paid.
 */
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

  insert into order_events (order_id, type, message, data, is_customer_visible)
  values (new.order_id, 'refund', 'Refund issued',
          jsonb_build_object('amount_cents', new.amount_cents, 'reason', new.reason), true);

  return null;
end $$;

create trigger refunds_effects
  after insert on refunds
  for each row execute function public.refunds_after_insert();
