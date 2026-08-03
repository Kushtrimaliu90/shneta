-- =============================================================================
-- 38 · M12 · The merchant's own fulfilment list, in one round trip
-- Source: docs/16 §3, §7.
-- =============================================================================

/*
 * A summary of every fulfilment this merchant holds.
 *
 * `merchant_fulfilment_view(id)` is the only read path into order data (§3) and stays that way for
 * *detail*. A list is a different question: calling the single-row function twenty times to render one
 * screen is twenty round trips, and the alternative — letting the portal join `order_fulfilments` to
 * `orders` for the order number — is exactly the join §3 refuses to grant, because a join that exists
 * for one column is a join a later feature reaches through for another.
 *
 * So this is the list-shaped member of the same family: security definer, fixed jsonb shape, scoped by
 * `current_merchant_ids()`, returning strictly less than the detail view.
 *
 * ── What it withholds, and why each one ──
 *
 *   · **No address, ever.** Not even on an assigned fulfilment. A list is a screen somebody scrolls
 *     past; the address belongs on the one fulfilment they are about to pack, which is the detail view.
 *   · **No customer name, email or phone.** Same reason as everywhere else in §3.
 *   · **No order total.** `items_subtotal_cents` is *this fulfilment's* lines. A merchant that could
 *     see the order total could infer what else the customer bought and from whom.
 *
 * The COD amount is this fulfilment's subtotal, never the order total, and it reads `is_cod` from
 * `payments` rather than from `orders` — the provider lives on the payment, because a failed card
 * attempt followed by cash on delivery is two rows and one order (docs/16 §3).
 */
create or replace function public.merchant_fulfilment_list(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(row order by row->>'created_at' desc), '[]'::jsonb)
    into result
    from (
      select jsonb_build_object(
        'id', f.id,
        'status', f.status,
        'created_at', f.created_at,
        'assigned_at', f.assigned_at,
        'accepted_at', f.accepted_at,
        'shipped_at', f.shipped_at,
        'carrier', f.carrier,
        'tracking_code', f.tracking_code,
        'items_subtotal_cents', f.items_subtotal_cents,
        'commission_cents', f.commission_cents,
        'merchant_due_cents', f.merchant_due_cents,
        'order_number', o.order_number,
        'placed_at', o.placed_at,
        'line_count', (
          select count(*) from order_items oi where oi.fulfilment_id = f.id
        ),
        'unit_count', coalesce((
          select sum(oi.quantity) from order_items oi where oi.fulfilment_id = f.id
        ), 0),
        'cod_amount_cents', case
          when exists (
            select 1 from payments p
             where p.order_id = f.order_id
               and p.provider = 'cod'
               and p.status in ('pending', 'paid')
          ) then f.items_subtotal_cents
          else 0
        end
      ) as row
      from order_fulfilments f
      join orders o on o.id = f.order_id
     where f.merchant_id = any (public.current_merchant_ids())
       and (p_status is null or f.status::text = p_status)
    ) rows;

  return result;
end $$;

comment on function public.merchant_fulfilment_list is
  'Summaries of the calling merchant''s fulfilments. No address, no customer, no order total. docs/16 §3.';

revoke all on function public.merchant_fulfilment_list(text) from public, anon;
grant execute on function public.merchant_fulfilment_list(text) to authenticated;

/*
 * Counts per status, for the filter chips. Separate from the list because the chips must show every
 * status's count while the list shows one status's rows — deriving one from the other would mean
 * fetching everything to render a filter.
 */
create or replace function public.merchant_fulfilment_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(status::text, n),
    '{}'::jsonb
  )
  from (
    select status, count(*) as n
      from order_fulfilments
     where merchant_id = any (public.current_merchant_ids())
     group by status
  ) counted
$$;

comment on function public.merchant_fulfilment_counts is
  'Fulfilment counts per status for the calling merchant. docs/16 §7.';

revoke all on function public.merchant_fulfilment_counts() from public, anon;
grant execute on function public.merchant_fulfilment_counts() to authenticated;

-- -----------------------------------------------------------------------------
-- The routing queue, for staff
-- -----------------------------------------------------------------------------

/*
 * Every fulfilment waiting for a decision, with enough context to make it.
 *
 * Staff-only and deliberately **not** a view: it names the proposed merchant, the order it belongs to,
 * and how long it has been waiting, which is the SLA the auto-accept setting is measured against (§6).
 * A view over these tables would be reachable by anyone with select on them, and `order_fulfilments`
 * grants select to every merchant for its own rows.
 */
create or replace function public.routing_queue(p_include_assigned boolean default false)
returns table (
  fulfilment_id uuid,
  order_id uuid,
  order_number text,
  placed_at timestamptz,
  status fulfilment_status,
  proposed_merchant_id uuid,
  proposed_merchant_name text,
  items_subtotal_cents int,
  line_count int,
  unit_count int,
  waiting_hours numeric,
  is_cod boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    is_service_role()
    or has_any_role(array['support','warehouse_manager','admin']::user_role[])
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
    select
      f.id,
      f.order_id,
      o.order_number::text,
      o.placed_at,
      f.status,
      f.merchant_id,
      m.display_name::text,
      f.items_subtotal_cents,
      (select count(*)::int from order_items oi where oi.fulfilment_id = f.id),
      coalesce((select sum(oi.quantity)::int from order_items oi where oi.fulfilment_id = f.id), 0),
      round(extract(epoch from (now() - f.created_at)) / 3600.0, 1),
      exists (
        select 1 from payments p
         where p.order_id = f.order_id and p.provider = 'cod' and p.status in ('pending', 'paid')
      )
      from order_fulfilments f
      join orders o on o.id = f.order_id
      left join merchants m on m.id = f.merchant_id
     where f.fulfiller_kind = 'merchant'
       and (
         f.status = 'unassigned'
         or (p_include_assigned and f.status = 'assigned')
       )
       -- A cancelled order has no routing decision left to take.
       and o.status not in ('cancelled', 'refunded')
     -- Oldest first: a routing queue is a queue, and waiting time is the SLA.
     order by f.created_at asc;
end $$;

comment on function public.routing_queue is
  'Merchant fulfilments awaiting a routing decision, oldest first. Staff-only. docs/16 §6.';

revoke all on function public.routing_queue(boolean) from public, anon;
grant execute on function public.routing_queue(boolean) to authenticated, service_role;

/*
 * The lines of one fulfilment, for the routing screen.
 *
 * Staff-only, and it exists because the admin deciding where to send a parcel has to see what is in it.
 * `order_items` already grants staff select, so this is a convenience with a capability check rather
 * than a new read path — the check is what stops a merchant using it to read a rival's fulfilment.
 */
create or replace function public.fulfilment_lines(p_fulfilment_id uuid)
returns table (
  item_id uuid,
  sku text,
  name_snapshot text,
  quantity int,
  unit_price_cents int,
  total_cents int,
  offer_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    is_service_role()
    or has_any_role(array['support','warehouse_manager','admin']::user_role[])
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
    select oi.id, oi.sku::text, oi.name_snapshot::text, oi.quantity,
           oi.unit_price_cents, oi.total_cents, oi.merchant_offer_id
      from order_items oi
     where oi.fulfilment_id = p_fulfilment_id
     order by oi.name_snapshot;
end $$;

comment on function public.fulfilment_lines is
  'The lines of one fulfilment, for the routing screen. Staff-only. docs/16 §6.';

revoke all on function public.fulfilment_lines(uuid) from public, anon;
grant execute on function public.fulfilment_lines(uuid) to authenticated, service_role;
