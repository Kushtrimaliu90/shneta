-- =============================================================================
-- 37 · M12 · fulfilment_candidates — slug is citext, and the signature said text
-- Source: docs/16 §6; the trap is docs/13 §X2.
-- =============================================================================

/*
 * `structure of query does not match function result type — returned type extensions.citext does not
 * match expected type text in column 3`.
 *
 * `merchants.slug` is `extensions.citext`, not `text` — deliberately, so `/seller/alpha` and
 * `/seller/Alpha` are the same merchant. A `returns table (… merchant_slug text …)` signature has to
 * match the query's types **exactly**: unlike a normal select, plpgsql will not widen citext to text
 * on the way out.
 *
 * The same deferral as §X1 — a `returns table` mismatch is a runtime error at first call, not a create
 * error — and the same lesson, which is that the marketplace's own column types are worth checking
 * against rather than assumed. `variant_buy_box` returns `merchant_slug text` and works, because it is
 * `language sql` and the outer `select` list coerces; this one is plpgsql with `return query`, which
 * does not.
 *
 * `::text` on the projection rather than `citext` in the signature: the callers are TypeScript, which
 * has one string type, and a signature that names a Postgres extension type in its contract for no
 * caller's benefit is a detail leaking outward.
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
      m.display_name::text,
      m.slug::text,
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
