-- =============================================================================
-- 48 · M12 · merchant_bulk_upsert_offers — restore the SKU tie-break migration 47 dropped
-- Source: docs/13 §X3 (the trap) and §X4 (the fix being restored).
-- =============================================================================

/*
 * Migration 47 restated `merchant_bulk_update_offers` as `merchant_bulk_upsert_offers` and copied the
 * body from migration 39 — which still had `order by (lower(o.merchant_sku) = lower(v_sku)) desc`.
 * Migration 40 had already replaced that with a `case` expression, because **`desc` implies `nulls
 * first`**: for an offer with no `merchant_sku`, `null = 'X'` is NULL, so the row that matched on nothing
 * sorted above the row that matched on the merchant's own code.
 *
 * That is §X3 happening again, in the migration whose own header comment cites §X3. Reading the warning is
 * not the same as checking. What caught it was the regression test written when §X4 was first fixed —
 * `matches the merchant's own SKU in preference to BioCode's` — which failed within a minute of the push.
 *
 * The lesson stands and gets sharper: **a restated function is the accumulation of every migration that
 * ever touched it.** Before restating one, read them all, in order — or better, do not restate. And keep
 * the test that pins the behaviour, because it is the only thing that notices.
 *
 * The variant lookup below uses the same `case` form even though `product_variants.sku` is `not null` and
 * the comparison can never be NULL. Consistency is cheap; a reader working out which of two orderings is
 * safe, twice, is not.
 */
create or replace function public.merchant_bulk_upsert_offers(
  p_merchant_id uuid,
  p_rows jsonb,
  p_create boolean default false
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
  v_handling int;
  v_threshold int;
  v_offer_id uuid;
  v_variant_id uuid;
  v_blocking offer_status;
  v_applied int := 0;
  v_created int := 0;
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
    v_handling := nullif(v_row->>'handling_days', '')::int;
    v_threshold := nullif(v_row->>'low_stock_threshold', '')::int;

    if v_sku = '' then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('sku', v_row->>'sku', 'reason', 'no_sku')
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

    if v_handling is not null and (v_handling < 0 or v_handling > 30) then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('sku', v_sku, 'reason', 'invalid_handling')
      );
      continue;
    end if;

    if v_threshold is not null and v_threshold < 0 then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('sku', v_sku, 'reason', 'invalid_threshold')
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
      * The merchant's own code wins when both match, since that is what it typed.
      *
      * `case`, not `… desc`: `merchant_sku` is nullable, `null = 'X'` is NULL, and `desc` implies
      * `nulls first` — so the boolean ordering put the row that matched on nothing first. docs/13 §X4.
      */
     order by case when lower(o.merchant_sku) = lower(v_sku) then 0 else 1 end
     limit 1;

    -- ── An offer to change ────────────────────────────────────────────────────
    if v_offer_id is not null then
      if v_stock is null and v_price is null and v_handling is null and v_threshold is null then
        v_skipped := v_skipped || jsonb_build_array(
          jsonb_build_object('sku', v_sku, 'reason', 'nothing_to_change')
        );
        continue;
      end if;

      update merchant_offers
         set stock_on_hand = coalesce(v_stock, stock_on_hand),
             price_cents = coalesce(v_price, price_cents),
             handling_days = coalesce(v_handling, handling_days),
             low_stock_threshold = coalesce(v_threshold, low_stock_threshold),
             updated_at = now()
       where id = v_offer_id;

      v_applied := v_applied + 1;
      continue;
    end if;

    -- ── Or a new one ──────────────────────────────────────────────────────────
    if not p_create then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('sku', v_sku, 'reason', 'no_matching_offer')
      );
      continue;
    end if;

    select pv.id into v_variant_id
      from product_variants pv
      join products p on p.id = pv.product_id
     where p.status = 'published'
       and p.deleted_at is null
       and pv.is_active
       and (lower(pv.sku) = lower(v_sku) or lower(pv.barcode) = lower(v_sku))
     -- The SKU is the canonical key; a barcode match is the fallback for a merchant that has only that.
     order by case when lower(pv.sku) = lower(v_sku) then 0 else 1 end
     limit 1;

    if v_variant_id is null then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('sku', v_sku, 'reason', 'unknown_sku')
      );
      continue;
    end if;

    /*
     * `unique (merchant_id, variant_id)` means one offer per variant per merchant, and the search above
     * only looked at the three states a merchant may edit. An offer in `pending_review` or `rejected`
     * would collide — so say which it is, because the two need different things from the merchant: wait,
     * or open the offer and read the reviewer's note.
     */
    select o.status into v_blocking
      from merchant_offers o
     where o.merchant_id = p_merchant_id and o.variant_id = v_variant_id
     limit 1;

    if v_blocking is not null then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object(
          'sku', v_sku,
          'reason', case v_blocking when 'pending_review' then 'awaiting_review' else 'offer_rejected' end
        )
      );
      continue;
    end if;

    -- A price is the one field with no sensible default: it is the whole offer.
    if v_price is null then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('sku', v_sku, 'reason', 'price_required')
      );
      continue;
    end if;

    insert into merchant_offers (
      merchant_id, variant_id, merchant_sku, price_cents, stock_on_hand,
      handling_days, low_stock_threshold, status
    )
    values (
      p_merchant_id,
      v_variant_id,
      -- What the merchant typed, kept so its next sheet matches on its own code.
      v_sku,
      v_price,
      coalesce(v_stock, 0),
      coalesce(v_handling, 1),
      coalesce(v_threshold, 3),
      -- Draft, never `pending_review`: submitting for review is a decision, not a side effect of a paste.
      'draft'
    )
    returning id into v_offer_id;

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object(
    'applied', v_applied,
    'created', v_created,
    'skipped', v_skipped,
    'skipped_count', jsonb_array_length(v_skipped)
  );
end $$;
