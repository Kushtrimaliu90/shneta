-- =============================================================================
-- 42 · M12 · The bulk-update SKU tie-break lost to the row with no SKU
-- Source: docs/16 §6; the trap is docs/13 §X4.
-- =============================================================================

/*
 * `order by (lower(o.merchant_sku) = lower(v_sku)) desc` was meant to say "the merchant's own code wins
 * when both match". It said the opposite.
 *
 * **`desc` implies `nulls first` in Postgres.** For an offer with `merchant_sku is null`, the expression
 * `lower(null) = lower(v_sku)` is `null`, not `false` — so that row sorted *ahead* of the row where the
 * comparison was genuinely `true`, and a merchant uploading its own code updated whichever offer happened
 * to have no code at all.
 *
 * A `case` expression instead of a boolean, so the ordering is over 0 and 1 with no null to place. It
 * also reads as what it means, which a bare boolean with a modifier does not.
 *
 * Found by the test that asserts the collision directly: one offer whose merchant code equals another
 * offer's BioCode code. Nothing simpler would have caught it, because with only one candidate the wrong
 * ordering still picks the right row.
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
     /*
      * The merchant's own code wins the tie, expressed as 0-before-1 rather than as a boolean sorted
      * `desc` — see the note above. An offer with no `merchant_sku` yields `null` from the comparison,
      * and `desc` would have placed that null first.
      */
     order by case when lower(o.merchant_sku) = lower(v_sku) then 0 else 1 end
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
