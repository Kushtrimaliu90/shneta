-- =============================================================================
-- 36 · M12 · route_order — the enum cast plpgsql deferred until the first order
-- Source: docs/16 §6; the trap is docs/13 §X1.
-- =============================================================================

/*
 * `column "status" is of type fulfilment_status but expression is of type text`.
 *
 * `case when … then 'assigned' else 'unassigned' end` has type `text`: the branches are unknown-type
 * literals, and `case` resolves them to `text` rather than leaving them unknown for the target column
 * to interpret. A bare `'assigned'` in the same position would have been coerced; wrapping it in a
 * `case` is what took the coercion away.
 *
 * The trap is the familiar one and it caught the same project twice (docs/16 §2): **plpgsql validates
 * a function body at first execution, not at `create`.** Migration 34 applied perfectly, `check:sql`
 * passed, and the defect surfaced as a failed checkout — that is, on the first order anyone placed.
 * Nothing short of executing the path could have found it, which is the argument for the routing
 * integration suite existing before the screens do.
 *
 * Only the two casts change. The body is otherwise identical to migration 34.
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
      (case when v_group.kind = 'biocode' then 'assigned' else 'unassigned' end)::fulfilment_status,
      v_group.subtotal_cents,
      coalesce((v_settlement->>'commission_cents')::int, 0),
      coalesce((v_settlement->>'merchant_due_cents')::int, 0)
    )
    returning id into v_fulfilment;

    update order_items set fulfilment_id = v_fulfilment where id = any (v_group.item_ids);
    v_created := v_created + 1;
  end loop;

  if exists (
    select 1 from order_fulfilments
     where order_id = p_order_id and status = 'unassigned'
  ) then
    insert into order_events (order_id, type, message, is_customer_visible)
    values (p_order_id, 'note', 'Awaiting merchant routing', false);
  end if;

  return v_created;
end $$;

/*
 * The same class of defect, in the same file, found by reading rather than by running: the derived
 * order status assigns a `text` case expression to an `order_status` variable.
 *
 * `v_target order_status` is declared, so plpgsql would coerce on assignment — `case … end` to a
 * declared enum variable is an assignment cast and does work. It is cast explicitly anyway, because
 * the difference between "coerces on assignment" and "coerces in an INSERT target list" is not a
 * distinction worth relying on twice in one migration.
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

  v_target := (case when v_shipped >= v_total then 'shipped' else 'partially_shipped' end)::order_status;

  if v_order.status = v_target then
    return;
  end if;

  if v_order.status in ('pending', 'confirmed') then
    if v_order.status = 'pending' then
      update orders set status = 'confirmed' where id = p_order_id;
    end if;
    update orders set status = 'processing' where id = p_order_id;
  end if;

  update orders set status = v_target where id = p_order_id;
end $$;
