-- =============================================================================
-- 34 · M12 · Routing — splitting an order, and moving a reservation
-- Source: docs/16 §6, §7.
-- =============================================================================

/*
 * ── What this migration and the next one turn on together ──
 *
 * Until now a merchant offer was live on the storefront and unbuyable: `checkout_create_order`
 * required BioCode `inventory_levels` stock and decremented it, so a merchant-only variant rendered
 * as out of stock however much stock a merchant held (docs/16 §5). This is the step that closes it,
 * and it lands together with routing on purpose — an order nobody can route, accept or ship is worse
 * for the customer than a product marked out of stock.
 *
 * Three pieces, in the order they run:
 *
 *   1. **Checkout** (migration 35) resolves each line to a source. BioCode first, always; otherwise
 *      the buy-box winner, whose offer stock is **reserved** there and then.
 *   2. **`route_order`** splits the order into one fulfilment per fulfiller and moves the lines onto
 *      them. Mechanical, idempotent, called at the end of checkout.
 *   3. **`assign_fulfilment`** is the admin decision: confirm the proposed merchant or pick another,
 *      moving the reservation with it.
 *
 * ── Why the reservation happens at checkout and not at routing ──
 *
 * Routing is an admin decision taken after the order exists, so the obvious design is to take the
 * merchant's stock when the fulfilment is assigned. That oversells: two customers buying the last
 * unit both succeed at checkout, and the merchant declines one of them a day later. Reserving at
 * checkout makes the buy box's answer binding for the order it answered, and the functions below move
 * the reservation whenever the routing decision moves.
 *
 * This file comes first because plpgsql resolves names at **first execution**, not at create time —
 * so migration 35's checkout can call `route_order` regardless of order, but relying on that is how a
 * migration applies cleanly and breaks at runtime (docs/16 §2). Defining the callee first costs
 * nothing.
 */

-- -----------------------------------------------------------------------------
-- route_order — split an order into one fulfilment per fulfiller
-- -----------------------------------------------------------------------------

/*
 * Mechanical and idempotent: it groups the order's lines by the source checkout chose and writes one
 * `order_fulfilments` row per group, then stamps `order_items.fulfilment_id`.
 *
 * ── The two statuses, and why they differ ──
 *
 *   · A **BioCode** fulfilment is created `assigned`. There is nobody to ask: BioCode's warehouse
 *     queue is the existing order screen, and a first-party fulfilment waiting for somebody to accept
 *     it would be a state with no actor.
 *   · A **merchant** fulfilment is created `unassigned`, even though it already names the merchant
 *     whose stock checkout reserved. The name is a *proposal* from the buy box; the assignment is an
 *     admin decision (§6), and `unassigned` is what puts it on `/admin/routing`.
 *
 * The `fulfilment_merchant_iff_merchant_kind` constraint forces the merchant id to be present on
 * exactly the merchant rows, so a proposal cannot be lost by an insert that forgot it.
 *
 * Money is computed **per fulfilment** through `merchant_settlement`, the only place that arithmetic
 * lives (§8). A BioCode fulfilment carries the subtotal and zeroes, because commission on your own
 * stock is a number with no meaning.
 *
 * Idempotent by existence check rather than `on conflict`: the natural key is
 * (order, fulfiller_kind, merchant_id), and expressing that as a partial unique index over a nullable
 * column would still not stop a second BioCode row on an order that legitimately has one.
 */
create or replace function public.route_order(p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group record;
  v_fulfilment uuid;
  v_settlement jsonb;
  v_created int := 0;
begin
  if not exists (select 1 from orders where id = p_order_id) then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  -- Already split. Re-routing is `assign_fulfilment`'s job, not this function's.
  if exists (select 1 from order_fulfilments where order_id = p_order_id) then
    return 0;
  end if;

  for v_group in
    select
      case when oi.merchant_offer_id is null then 'biocode' else 'merchant' end as kind,
      mo.merchant_id as merchant_id,
      sum(oi.total_cents)::int as subtotal_cents,
      array_agg(oi.id) as item_ids
    from order_items oi
    left join merchant_offers mo on mo.id = oi.merchant_offer_id
   where oi.order_id = p_order_id
   group by 1, 2
   -- BioCode first, so its fulfilment is the oldest row on every mixed order.
   order by 1 desc
  loop
    if v_group.kind = 'merchant' then
      v_settlement := public.merchant_settlement(v_group.merchant_id, v_group.subtotal_cents);
    else
      v_settlement := null;
    end if;

    insert into order_fulfilments (
      order_id, fulfiller_kind, merchant_id, status,
      items_subtotal_cents, commission_cents, merchant_due_cents
    ) values (
      p_order_id,
      v_group.kind,
      v_group.merchant_id,
      case when v_group.kind = 'biocode' then 'assigned' else 'unassigned' end,
      v_group.subtotal_cents,
      coalesce((v_settlement->>'commission_cents')::int, 0),
      coalesce((v_settlement->>'merchant_due_cents')::int, 0)
    )
    returning id into v_fulfilment;

    update order_items set fulfilment_id = v_fulfilment where id = any (v_group.item_ids);
    v_created := v_created + 1;
  end loop;

  /*
   * An order that needs a routing decision is worth an event on its own timeline. **Not** customer
   * visible: "we are deciding which supplier ships your parcel" is BioCode's internal business, and
   * saying it out loud invites a question the customer has no way to act on.
   */
  if exists (
    select 1 from order_fulfilments
     where order_id = p_order_id and status = 'unassigned'
  ) then
    insert into order_events (order_id, type, message, is_customer_visible)
    values (p_order_id, 'note', 'Awaiting merchant routing', false);
  end if;

  return v_created;
end $$;

comment on function public.route_order is
  'Splits an order into one fulfilment per fulfiller. Idempotent. docs/16 §6.';

revoke all on function public.route_order(uuid) from public, anon;
grant execute on function public.route_order(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- fulfilment_candidates — who could ship this, for the routing screen
-- -----------------------------------------------------------------------------

/*
 * Every merchant that could cover **every line** of a fulfilment, with the numbers an admin needs to
 * choose between them.
 *
 * "Every line" is the load-bearing word: a merchant holding two of the three products is not a
 * candidate, because splitting a fulfilment further would mean two parcels from two suppliers for
 * lines the customer bought together. The `having` clause is what says so.
 *
 * Staff-only, and it raises rather than returning nothing for a merchant — it exposes rival asking
 * prices and stock levels, which is precisely what §3 keeps merchants from seeing about each other,
 * so a silent empty result would be the wrong shape of answer to a call that should not have happened.
 */
create or replace function public.fulfilment_candidates(p_fulfilment_id uuid)
returns table (
  merchant_id uuid,
  merchant_name text,
  merchant_slug text,
  rating_avg numeric,
  asking_total_cents int,
  merchant_due_cents int,
  commission_pct numeric,
  max_handling_days int,
  is_current boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fulfilment order_fulfilments%rowtype;
  v_line_count int;
begin
  if not (
    is_service_role()
    or has_any_role(array['support','warehouse_manager','admin']::user_role[])
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_fulfilment from order_fulfilments where id = p_fulfilment_id;
  if v_fulfilment.id is null then
    return;
  end if;

  select count(*) into v_line_count from order_items where fulfilment_id = p_fulfilment_id;
  if v_line_count = 0 then
    return;
  end if;

  return query
    select
      m.id,
      m.display_name,
      m.slug,
      m.rating_avg,
      sum(o.price_cents * oi.quantity)::int,
      (public.merchant_settlement(m.id, v_fulfilment.items_subtotal_cents) ->> 'merchant_due_cents')::int,
      m.commission_pct,
      max(o.handling_days)::int,
      m.id = v_fulfilment.merchant_id
      from order_items oi
      join merchant_offers o
        on o.variant_id = oi.variant_id
       and o.status = 'approved'
      join merchants m
        on m.id = o.merchant_id
       and m.status = 'approved'
     where oi.fulfilment_id = p_fulfilment_id
       /*
        * Stock the merchant holds *now*, plus whatever this line has already reserved from it —
        * otherwise the merchant currently holding the reservation looks short of its own order.
        */
       and o.stock_on_hand
           + case when o.id = oi.merchant_offer_id then oi.quantity else 0 end
           >= oi.quantity
     group by m.id, m.display_name, m.slug, m.rating_avg, m.commission_pct
    having count(distinct oi.id) = v_line_count
     -- Cheapest to source first, then the better-rated merchant, then alphabetically.
     order by 5 asc, m.rating_avg desc, m.display_name asc;
end $$;

comment on function public.fulfilment_candidates is
  'Merchants that can cover every line of a fulfilment, with asking price and settlement. Staff-only. docs/16 §6.';

revoke all on function public.fulfilment_candidates(uuid) from public, anon;
grant execute on function public.fulfilment_candidates(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- assign_fulfilment — the admin routing decision
-- -----------------------------------------------------------------------------

/*
 * Confirms a merchant for a fulfilment, or moves it to a different one.
 *
 * ── What makes this more than a status update ──
 *
 * The merchant's stock was reserved at checkout, so routing has to **move the reservation**: take the
 * quantity from the incoming merchant's offers and return it to the outgoing one's, atomically with
 * the assignment. A version that only changed `merchant_id` would leave one merchant short of stock
 * it never sold and the other overselling stock it never reserved, and neither would notice until a
 * customer did.
 *
 * The money is recomputed, because commission is per merchant: the same subtotal pays a different
 * merchant a different amount, and the fulfilment has to carry the answer its own statement will use.
 *
 * ── The four cases, all handled by one loop ──
 *
 * Confirming the buy box's proposal, re-routing to a rival, re-assigning after a decline to the same
 * merchant, and re-assigning after a decline to a different one. The loop asks per line "is this
 * already reserved from the merchant we are assigning to?" and skips only then — an earlier version
 * keyed the whole decision on `merchant_id` changing and silently left the lines of a released
 * fulfilment with no reservation at all when it was reassigned to the same merchant.
 *
 * Refuses a fulfilment the merchant has already accepted. At that point they are packing, and taking
 * the order away is a conversation rather than a button — cancel it instead.
 */
create or replace function public.assign_fulfilment(
  p_fulfilment_id uuid,
  p_merchant_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fulfilment order_fulfilments%rowtype;
  v_actor uuid := auth.uid();
  v_item record;
  v_offer_id uuid;
  v_settlement jsonb;
  v_previous uuid;
  v_moved int := 0;
begin
  if not (
    is_service_role()
    or has_any_role(array['support','warehouse_manager','admin']::user_role[])
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_fulfilment from order_fulfilments where id = p_fulfilment_id for update;
  if v_fulfilment.id is null then
    raise exception 'FULFILMENT_NOT_FOUND';
  end if;
  if v_fulfilment.fulfiller_kind <> 'merchant' then
    raise exception 'NOT_A_MERCHANT_FULFILMENT';
  end if;
  if v_fulfilment.status not in ('unassigned', 'assigned') then
    raise exception 'FULFILMENT_ALREADY_IN_PROGRESS:%', v_fulfilment.status;
  end if;

  if not exists (select 1 from merchants where id = p_merchant_id and status = 'approved') then
    raise exception 'MERCHANT_NOT_APPROVED';
  end if;

  v_previous := v_fulfilment.merchant_id;

  for v_item in
    select id, variant_id, quantity, merchant_offer_id
      from order_items
     where fulfilment_id = p_fulfilment_id
  loop
    -- Already reserved from the merchant being assigned: nothing to move.
    if v_item.merchant_offer_id is not null
       and exists (
         select 1 from merchant_offers
          where id = v_item.merchant_offer_id and merchant_id = p_merchant_id
       )
    then
      continue;
    end if;

    select id into v_offer_id
      from merchant_offers
     where merchant_id = p_merchant_id
       and variant_id = v_item.variant_id
       and status = 'approved'
       and stock_on_hand >= v_item.quantity
       for update;

    if v_offer_id is null then
      -- Aborts the whole assignment: a half-routed fulfilment is worse than a refused one.
      raise exception 'CANDIDATE_CANNOT_COVER:%', v_item.variant_id;
    end if;

    update merchant_offers
       set stock_on_hand = stock_on_hand - v_item.quantity, updated_at = now()
     where id = v_offer_id;

    if v_item.merchant_offer_id is not null then
      update merchant_offers
         set stock_on_hand = stock_on_hand + v_item.quantity, updated_at = now()
       where id = v_item.merchant_offer_id;
    end if;

    update order_items set merchant_offer_id = v_offer_id where id = v_item.id;
    v_moved := v_moved + 1;
  end loop;

  v_settlement := public.merchant_settlement(p_merchant_id, v_fulfilment.items_subtotal_cents);

  update order_fulfilments
     set merchant_id = p_merchant_id,
         status = 'assigned',
         assigned_by = v_actor,
         assigned_at = now(),
         commission_cents = coalesce((v_settlement->>'commission_cents')::int, 0),
         merchant_due_cents = coalesce((v_settlement->>'merchant_due_cents')::int, 0),
         cancel_reason = null
   where id = p_fulfilment_id;

  insert into order_events (order_id, type, message, data, is_customer_visible)
  values (
    v_fulfilment.order_id,
    'note',
    case
      when v_previous is distinct from p_merchant_id then 'Fulfilment routed to a different merchant'
      else 'Fulfilment assignment confirmed'
    end,
    jsonb_build_object(
      'fulfilment_id', p_fulfilment_id,
      'merchant_id', p_merchant_id,
      'previous_merchant_id', v_previous,
      'lines_moved', v_moved
    ),
    false
  );

  return jsonb_build_object(
    'fulfilment_id', p_fulfilment_id,
    'merchant_id', p_merchant_id,
    'reassigned', v_previous is distinct from p_merchant_id,
    'lines_moved', v_moved,
    'merchant_due_cents', coalesce((v_settlement->>'merchant_due_cents')::int, 0)
  );
end $$;

comment on function public.assign_fulfilment is
  'Routes a fulfilment to a merchant, moving the stock reservation and the settlement with it. docs/16 §6.';

revoke all on function public.assign_fulfilment(uuid, uuid) from public, anon;
grant execute on function public.assign_fulfilment(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- release_fulfilment — a decline, or an admin taking it back
-- -----------------------------------------------------------------------------

/*
 * Returns a fulfilment to the routing queue and its reservation to the merchant.
 *
 * A merchant declining is the ordinary path: the transition guard lets a merchant move
 * `assigned → cancelled`, and this is what makes the row assignable again. The declining merchant's
 * stock goes back because it never sold anything — leaving it reserved would silently shrink the
 * stock of the one merchant who was honest about not being able to ship.
 *
 * `merchant_id` stays on the row, because the constraint requires it on a merchant fulfilment and
 * because the *last* merchant to hold it is worth knowing. What marks the row as awaiting routing is
 * the status plus the lines having no `merchant_offer_id`; the fulfilment's `fulfiller_kind` is what
 * stops a null offer id being mistaken for "BioCode sourced it".
 *
 * The declining merchant is recorded in the event, which is what a scorecard reads later (§6).
 */
create or replace function public.release_fulfilment(
  p_fulfilment_id uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fulfilment order_fulfilments%rowtype;
  v_item record;
begin
  if not (
    is_service_role()
    or has_any_role(array['support','warehouse_manager','admin']::user_role[])
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_fulfilment from order_fulfilments where id = p_fulfilment_id for update;
  if v_fulfilment.id is null then
    raise exception 'FULFILMENT_NOT_FOUND';
  end if;
  if v_fulfilment.fulfiller_kind <> 'merchant' then
    raise exception 'NOT_A_MERCHANT_FULFILMENT';
  end if;
  if v_fulfilment.status in ('shipped', 'delivered', 'returned') then
    raise exception 'FULFILMENT_ALREADY_IN_PROGRESS:%', v_fulfilment.status;
  end if;

  for v_item in
    select id, quantity, merchant_offer_id
      from order_items
     where fulfilment_id = p_fulfilment_id and merchant_offer_id is not null
  loop
    update merchant_offers
       set stock_on_hand = stock_on_hand + v_item.quantity, updated_at = now()
     where id = v_item.merchant_offer_id;

    update order_items set merchant_offer_id = null where id = v_item.id;
  end loop;

  update order_fulfilments
     set status = 'unassigned',
         assigned_by = null,
         assigned_at = null,
         accepted_at = null,
         cancel_reason = p_reason,
         commission_cents = 0,
         merchant_due_cents = 0
   where id = p_fulfilment_id;

  insert into order_events (order_id, type, message, data, is_customer_visible)
  values (
    v_fulfilment.order_id,
    'note',
    'Fulfilment returned to the routing queue',
    jsonb_build_object(
      'fulfilment_id', p_fulfilment_id,
      'released_merchant_id', v_fulfilment.merchant_id,
      'reason', p_reason
    ),
    false
  );
end $$;

comment on function public.release_fulfilment is
  'Returns a fulfilment to the queue and its reservation to the merchant. docs/16 §6.';

revoke all on function public.release_fulfilment(uuid, text) from public, anon;
grant execute on function public.release_fulfilment(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Order status becomes derived from its fulfilments
-- -----------------------------------------------------------------------------

/*
 * `partially_shipped` was added to `order_status` in migration 28 and has been unreachable ever
 * since, because `orders_before_status_change` never allowed a transition into it. An enum value no
 * transition table admits is a column that can never hold it — which is worth stating, because the
 * migration that added the value applied perfectly and looked complete.
 *
 * Two new edges, and no others:
 *
 *   · `processing → partially_shipped` — the first fulfilment ships while another has not;
 *   · `partially_shipped → shipped | cancelled` — the last one ships, or the order is pulled.
 *
 * `confirmed → partially_shipped` is deliberately absent. An order that has shipped anything has been
 * worked on, and `processing` is the state that says so; admitting the edge would let an order skip
 * the state its own warehouse screen filters by.
 */
create or replace function public.orders_before_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending'            and new.status in ('confirmed','cancelled')) or
      (old.status = 'confirmed'          and new.status in ('processing','cancelled')) or
      (old.status = 'processing'         and new.status in ('shipped','partially_shipped','cancelled')) or
      (old.status = 'partially_shipped'  and new.status in ('shipped','cancelled')) or
      (old.status = 'shipped'            and new.status in ('delivered','refunded'))  or
      (old.status = 'delivered'          and new.status in ('refunded'))
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

/*
 * Restock on cancel, corrected for the marketplace.
 *
 * The original returned **every** line to `inventory_levels`, including lines BioCode never held.
 * Cancelling a merchant-sourced order would have invented first-party stock out of nothing — and the
 * `stock_movements` ledger would have agreed with it, which is worse than a bare discrepancy because
 * the audit trail would corroborate the fiction.
 *
 * Now each line goes back where it came from: BioCode lines to the warehouse with a movement row, and
 * merchant lines to the offer that reserved them, with no movement row (that ledger is the warehouse's
 * and its invariant is that its sum equals `on_hand` — docs/13 §A7).
 *
 * Everything else in this trigger is unchanged from migration 07.
 */
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

/*
 * The order's status, recomputed from its fulfilments.
 *
 * ── Why derived rather than set by whoever shipped last ──
 *
 * A mixed order has two shippers who do not know about each other: BioCode's warehouse marks its own
 * parcel shipped, and a merchant marks theirs. Neither is in a position to decide what the *order* is,
 * and the first version of any such feature has the second shipper overwrite the first. Deriving it
 * means the answer is a function of the facts, not of the click order.
 *
 * Only forward: it never moves an order back out of `shipped`, and it never touches an order that is
 * cancelled, refunded or delivered. Delivery is the courier's word (§7) and refunds are money — a
 * fulfilment update must not be able to reopen either.
 */
create or replace function public.sync_order_status_from_fulfilments(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_total int;
  v_shipped int;
  v_target order_status;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order.id is null then
    return;
  end if;

  -- Terminal or money states are not this function's business.
  if v_order.status in ('cancelled', 'refunded', 'delivered', 'shipped') then
    return;
  end if;

  select
    count(*) filter (where status <> 'cancelled'),
    count(*) filter (where status in ('shipped', 'delivered'))
    into v_total, v_shipped
    from order_fulfilments
   where order_id = p_order_id;

  if coalesce(v_total, 0) = 0 or coalesce(v_shipped, 0) = 0 then
    return;
  end if;

  v_target := case when v_shipped >= v_total then 'shipped' else 'partially_shipped' end;

  if v_order.status = v_target then
    return;
  end if;

  /*
   * `pending` and `confirmed` cannot reach either target directly — the transition table forbids it
   * and rightly so. Stepping through `processing` keeps the order's own history readable rather than
   * teaching the guard a shortcut that exists only for this caller.
   */
  if v_order.status in ('pending', 'confirmed') then
    if v_order.status = 'pending' then
      update orders set status = 'confirmed' where id = p_order_id;
    end if;
    update orders set status = 'processing' where id = p_order_id;
  end if;

  update orders set status = v_target where id = p_order_id;
end $$;

comment on function public.sync_order_status_from_fulfilments is
  'Derives order status from its fulfilments: partially_shipped, then shipped. Forward only. docs/16 §7.';

revoke all on function public.sync_order_status_from_fulfilments(uuid) from public, anon;
grant execute on function public.sync_order_status_from_fulfilments(uuid) to authenticated, service_role;

/*
 * Fired by any fulfilment reaching a shipped state, from any actor — a merchant clicking "shipped" in
 * the portal, BioCode's own shipment action, or a cron. A trigger rather than a call in each of those
 * paths, because the third one to be written is the one that forgets.
 *
 * `after update` and status-scoped, so the ordinary noise of a merchant editing a tracking code does
 * not re-derive an order status on every keystroke.
 */
create or replace function public.fulfilments_sync_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     and new.status in ('shipped', 'delivered', 'cancelled')
  then
    perform public.sync_order_status_from_fulfilments(new.order_id);
  end if;
  return null;
end $$;

create trigger order_fulfilments_sync_order
  after update of status on order_fulfilments
  for each row execute function public.fulfilments_sync_order();

/*
 * `shipped_at` and `packed_at`, stamped where they cannot be forgotten.
 *
 * The merchant portal posts a status and a tracking code; the timestamps are the database's business.
 * A merchant that could set its own `shipped_at` could backdate an SLA it is measured against (§6),
 * and the transition guard already refuses `delivered_at` for the same reason.
 */
create or replace function public.fulfilments_stamp_timestamps() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'accepted' and new.accepted_at is null then
      new.accepted_at := now();
    elsif new.status = 'packed' and new.packed_at is null then
      new.packed_at := now();
    elsif new.status = 'shipped' and new.shipped_at is null then
      new.shipped_at := now();
    elsif new.status = 'delivered' and new.delivered_at is null then
      new.delivered_at := now();
    end if;
  end if;
  return new;
end $$;

/*
 * Before the transition guard, so the guard sees the stamped row and its "the merchant may not touch
 * `delivered_at`" check still fires on a merchant who sent one. Trigger order within the same event is
 * alphabetical by name in Postgres, and `order_fulfilments_a_stamp` sorts before
 * `order_fulfilments_transition_guard` — named for that, not by accident.
 */
create trigger order_fulfilments_a_stamp
  before update on order_fulfilments
  for each row execute function public.fulfilments_stamp_timestamps();
