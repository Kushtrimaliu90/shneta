-- =============================================================================
-- 41 · M12 · The merchant scorecard, and rating that follows from it
-- Source: docs/16 §6, §11.
-- =============================================================================

/*
 * ── What a scorecard is for ──
 *
 * `merchants.rating_avg` is a **tie-break in the buy box** (§1), so it is not decoration: it decides
 * which of two equally-priced merchants gets the sale. That makes it a number that has to be earned by
 * something observable, not typed in by whoever last spoke to the merchant.
 *
 * Four things are observable from rows this system already writes, and each one is a promise the
 * marketplace terms make to a customer:
 *
 *   · **acceptance rate** — of fulfilments assigned, how many were accepted rather than declined;
 *   · **acceptance speed** — hours from assignment to acceptance, against the 24-hour window;
 *   · **dispatch speed** — hours from acceptance to shipping, against the offer's own handling days;
 *   · **cancellation rate** — of fulfilments accepted, how many were then cancelled or returned.
 *
 * Deliberately **not** a customer review score. A merchant is a supplier the customer never contracts
 * with (terms, clause 1) and mostly cannot name; asking shoppers to rate it would be asking them about
 * something they did not knowingly choose. What the customer's experience contributes is late dispatch
 * and cancellations, which are counted here.
 *
 * ── Why a function rather than columns ──
 *
 * A stored score has to be recomputed by something, and the something is always a job that has quietly
 * stopped. This reads the fulfilment history on demand, and only `rating_avg` — the one value the buy
 * box needs on every page load — is written down, by an explicit call.
 */
create or replace function public.merchant_scorecard(
  p_merchant_id uuid,
  p_since timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := coalesce(p_since, now() - interval '90 days');
  v_assigned int;
  v_accepted int;
  v_declined int;
  v_shipped int;
  v_delivered int;
  v_cancelled_after_accept int;
  v_accept_hours numeric;
  v_dispatch_hours numeric;
  v_late_dispatch int;
begin
  /*
   * Staff, or the merchant itself. A merchant seeing its own scorecard is the point — it is measured
   * against the terms, and a measurement it cannot see is not one it can improve. A merchant reading a
   * *rival's* would be reading operational data about a competitor, which §3 exists to prevent.
   */
  if not (
    is_service_role()
    or (select is_staff())
    or p_merchant_id = any (public.current_merchant_ids())
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select
    count(*) filter (where f.assigned_at is not null),
    count(*) filter (where f.accepted_at is not null),
    /*
     * A decline is a cancellation that never reached `accepted`, and the fulfilment row itself no longer
     * says so — `release_fulfilment` returns it to `unassigned` for re-routing. So declines are counted
     * from `order_events`, which is where the releasing merchant's id was recorded for exactly this.
     */
    0,
    count(*) filter (where f.shipped_at is not null),
    count(*) filter (where f.status = 'delivered'),
    count(*) filter (where f.accepted_at is not null and f.status in ('cancelled', 'returned')),
    avg(extract(epoch from (f.accepted_at - f.assigned_at)) / 3600.0)
      filter (where f.accepted_at is not null and f.assigned_at is not null),
    avg(extract(epoch from (f.shipped_at - f.accepted_at)) / 3600.0)
      filter (where f.shipped_at is not null and f.accepted_at is not null)
    into v_assigned, v_accepted, v_declined, v_shipped, v_delivered,
         v_cancelled_after_accept, v_accept_hours, v_dispatch_hours
    from order_fulfilments f
   where f.merchant_id = p_merchant_id
     and f.fulfiller_kind = 'merchant'
     and f.created_at >= v_since;

  select count(*)
    into v_declined
    from order_events e
   where e.type = 'note'
     and e.created_at >= v_since
     and e.data->>'released_merchant_id' = p_merchant_id::text;

  /*
   * Late dispatch is measured against the **offer's own** handling promise, not a marketplace default:
   * a merchant that said three days and took three days is on time, and one that said one day and took
   * three is not. Anything else would punish honesty about a slower shelf.
   */
  select count(*)
    into v_late_dispatch
    from order_fulfilments f
    join order_items oi on oi.fulfilment_id = f.id
    join merchant_offers o on o.id = oi.merchant_offer_id
   where f.merchant_id = p_merchant_id
     and f.shipped_at is not null
     and f.accepted_at is not null
     and f.created_at >= v_since
     and f.shipped_at > f.accepted_at + make_interval(days => o.handling_days + 1);

  return jsonb_build_object(
    'merchant_id', p_merchant_id,
    'since', v_since,
    'assigned', coalesce(v_assigned, 0),
    'accepted', coalesce(v_accepted, 0),
    'declined', coalesce(v_declined, 0),
    'shipped', coalesce(v_shipped, 0),
    'delivered', coalesce(v_delivered, 0),
    'cancelled_after_accept', coalesce(v_cancelled_after_accept, 0),
    'late_dispatch', coalesce(v_late_dispatch, 0),
    /*
     * Rates are null, not zero, when the denominator is zero. A new merchant has not failed to accept
     * anything — and a 0% acceptance rate on its first day would drop it to the bottom of every
     * tie-break before it had a chance to earn anything.
     */
    'acceptance_rate', case
      when coalesce(v_assigned, 0) + coalesce(v_declined, 0) = 0 then null
      else round(
        coalesce(v_accepted, 0)::numeric
        / (coalesce(v_assigned, 0) + coalesce(v_declined, 0)), 4
      )
    end,
    'cancellation_rate', case
      when coalesce(v_accepted, 0) = 0 then null
      else round(coalesce(v_cancelled_after_accept, 0)::numeric / v_accepted, 4)
    end,
    'avg_accept_hours', case when v_accept_hours is null then null else round(v_accept_hours, 1) end,
    'avg_dispatch_hours', case
      when v_dispatch_hours is null then null else round(v_dispatch_hours, 1)
    end
  );
end $$;

comment on function public.merchant_scorecard is
  'Observed fulfilment performance over a window. Own scorecard for a merchant, any for staff. docs/16 §6.';

revoke all on function public.merchant_scorecard(uuid, timestamptz) from public, anon;
grant execute on function public.merchant_scorecard(uuid, timestamptz) to authenticated, service_role;

/*
 * The rating the buy box reads, derived from the scorecard.
 *
 * Five stars, and the shape of the formula is the policy:
 *
 *   · a merchant with **no history is 0**, which loses every tie-break rather than winning one it has
 *     not earned. `rating_count` says why, so the number is never mistaken for a bad review;
 *   · acceptance and speed pull it up, cancellation and late dispatch pull it down;
 *   · it is **clamped to [0, 5]** so no single term can dominate.
 *
 * Written to `merchants.rating_avg` by an explicit call rather than by a trigger on every fulfilment
 * update. The buy box reads it hundreds of times a day and the inputs move a handful of times, so it is
 * cached — and the recalculation is a job the cron does, where a failure is visible, instead of a
 * trigger that quietly makes every shipment write slower.
 */
create or replace function public.recompute_merchant_rating(p_merchant_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card jsonb;
  v_acceptance numeric;
  v_cancellation numeric;
  v_accept_hours numeric;
  v_dispatch_late numeric;
  v_shipped int;
  v_rating numeric;
begin
  if not (is_service_role() or has_any_role(array['support','admin']::user_role[])) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  v_card := public.merchant_scorecard(p_merchant_id);
  v_shipped := coalesce((v_card->>'shipped')::int, 0);

  if v_shipped = 0 then
    update merchants set rating_avg = 0, rating_count = 0 where id = p_merchant_id;
    return 0;
  end if;

  v_acceptance := coalesce((v_card->>'acceptance_rate')::numeric, 0);
  v_cancellation := coalesce((v_card->>'cancellation_rate')::numeric, 0);
  v_accept_hours := coalesce((v_card->>'avg_accept_hours')::numeric, 24);
  v_dispatch_late := coalesce((v_card->>'late_dispatch')::int, 0)::numeric / greatest(v_shipped, 1);

  /*
   * 3 points for accepting what it is given, 1 for answering quickly, 1 for dispatching on time; a full
   * point of cancellation costs 2, because a cancellation after acceptance is the failure a customer
   * actually experiences.
   */
  v_rating :=
      3.0 * v_acceptance
    + 1.0 * greatest(0, 1 - (v_accept_hours / 24.0))
    + 1.0 * (1 - v_dispatch_late)
    - 2.0 * v_cancellation;

  v_rating := round(greatest(0, least(5, v_rating)), 2);

  update merchants
     set rating_avg = v_rating,
         rating_count = v_shipped
   where id = p_merchant_id;

  return v_rating;
end $$;

comment on function public.recompute_merchant_rating is
  'Derives merchants.rating_avg from the scorecard. No history scores 0, which loses every tie-break. docs/16 §6.';

revoke all on function public.recompute_merchant_rating(uuid) from public, anon;
grant execute on function public.recompute_merchant_rating(uuid) to authenticated, service_role;

/** Every merchant, for the nightly cron. Returns what it changed so a run can be reported. */
create or replace function public.recompute_all_merchant_ratings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant record;
  v_rating numeric;
  v_changed jsonb := '[]'::jsonb;
begin
  if not (is_service_role() or has_any_role(array['admin']::user_role[])) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  for v_merchant in
    select id, display_name, rating_avg from merchants where status = 'approved'
  loop
    v_rating := public.recompute_merchant_rating(v_merchant.id);
    if v_rating is distinct from v_merchant.rating_avg then
      v_changed := v_changed || jsonb_build_array(jsonb_build_object(
        'merchant_id', v_merchant.id,
        'merchant_name', v_merchant.display_name,
        'from', v_merchant.rating_avg,
        'to', v_rating
      ));
    end if;
  end loop;

  return jsonb_build_object('changed', v_changed);
end $$;

comment on function public.recompute_all_merchant_ratings is
  'Nightly rating recalculation across approved merchants. docs/16 §6.';

revoke all on function public.recompute_all_merchant_ratings() from public, anon;
grant execute on function public.recompute_all_merchant_ratings() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Bulk stock and price, from a CSV
-- -----------------------------------------------------------------------------

/*
 * Applies stock and price changes to many of a merchant's own offers at once.
 *
 * ── Why this is one function and not a loop in TypeScript ──
 *
 * A merchant uploading a hundred rows wants one answer: how many applied, and which did not and why.
 * A loop of a hundred round trips gets slower the more useful the feature is, and a failure halfway
 * leaves the merchant unable to tell what took effect. One call in one transaction gives a report.
 *
 * ── Matched on the merchant's own SKU, or BioCode's ──
 *
 * `merchant_sku` first, because that is what a merchant's own export contains. Falling back to
 * BioCode's `sku` means a merchant that never set its own codes can still use the feature.
 *
 * **Only `draft`, `approved` and `paused` offers are touched.** An offer awaiting review is mid-decision,
 * and a price that moved under a reviewer is a review of something that no longer exists.
 *
 * Price is optional per row: a stock-only upload is the common case and the daily one, and requiring a
 * price column would mean re-uploading prices nobody intended to change.
 */
create or replace function public.merchant_bulk_update_offers(
  p_merchant_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_sku text;
  v_stock int;
  v_price int;
  v_offer_id uuid;
  v_applied int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  -- The merchant itself, or staff acting for it. Not another merchant, ever.
  if not (
    is_service_role()
    or (select is_staff())
    or p_merchant_id = any (public.current_merchant_ids())
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ROWS_NOT_AN_ARRAY';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'TOO_MANY_ROWS';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_sku := trim(coalesce(v_row->>'sku', ''));
    v_stock := nullif(v_row->>'stock', '')::int;
    v_price := nullif(v_row->>'price_cents', '')::int;

    if v_sku = '' then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('sku', v_row->>'sku', 'reason', 'no_sku')
      );
      continue;
    end if;

    select o.id into v_offer_id
      from merchant_offers o
      join product_variants pv on pv.id = o.variant_id
     where o.merchant_id = p_merchant_id
       and o.status in ('draft', 'approved', 'paused')
       and (lower(o.merchant_sku) = lower(v_sku) or lower(pv.sku) = lower(v_sku))
     -- The merchant's own code wins when both match, since that is what it typed.
     order by (lower(o.merchant_sku) = lower(v_sku)) desc
     limit 1;

    if v_offer_id is null then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('sku', v_sku, 'reason', 'no_matching_offer')
      );
      continue;
    end if;

    if v_stock is null and v_price is null then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('sku', v_sku, 'reason', 'nothing_to_change')
      );
      continue;
    end if;

    if v_stock is not null and v_stock < 0 then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('sku', v_sku, 'reason', 'negative_stock')
      );
      continue;
    end if;

    if v_price is not null and v_price <= 0 then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('sku', v_sku, 'reason', 'invalid_price')
      );
      continue;
    end if;

    update merchant_offers
       set stock_on_hand = coalesce(v_stock, stock_on_hand),
           price_cents = coalesce(v_price, price_cents),
           updated_at = now()
     where id = v_offer_id;

    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object(
    'applied', v_applied,
    'skipped', v_skipped,
    'skipped_count', jsonb_array_length(v_skipped)
  );
end $$;

comment on function public.merchant_bulk_update_offers is
  'Applies stock and price to many of one merchant''s offers, reporting what it skipped. docs/16 §6.';

revoke all on function public.merchant_bulk_update_offers(uuid, jsonb) from public, anon;
grant execute on function public.merchant_bulk_update_offers(uuid, jsonb) to authenticated, service_role;

/*
 * A merchant's offers as export rows, so the upload it sends back is one it was given.
 *
 * The round trip matters more than it looks: a merchant editing a spreadsheet it exported has the right
 * SKUs by construction, and the `no_matching_offer` skips above stop being the common outcome.
 */
create or replace function public.merchant_offers_export(p_merchant_id uuid)
returns table (
  sku text,
  merchant_sku text,
  product_name text,
  variant_name text,
  status text,
  stock_on_hand int,
  price_cents int,
  retail_price_cents int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    is_service_role()
    or (select is_staff())
    or p_merchant_id = any (public.current_merchant_ids())
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
    select
      pv.sku::text,
      coalesce(o.merchant_sku, '')::text,
      coalesce(p.name->>'sq', p.name->>'en', '')::text,
      coalesce(pv.name->>'sq', pv.name->>'en', '')::text,
      o.status::text,
      o.stock_on_hand,
      o.price_cents,
      pv.price_cents
      from merchant_offers o
      join product_variants pv on pv.id = o.variant_id
      join products p on p.id = pv.product_id
     where o.merchant_id = p_merchant_id
     order by p.name->>'sq', pv.sku;
end $$;

comment on function public.merchant_offers_export is
  'One merchant''s offers as CSV rows. docs/16 §6.';

revoke all on function public.merchant_offers_export(uuid) from public, anon;
grant execute on function public.merchant_offers_export(uuid) to authenticated, service_role;
