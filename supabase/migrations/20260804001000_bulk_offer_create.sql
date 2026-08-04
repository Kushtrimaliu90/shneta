-- =============================================================================
-- 47 · M12 · bulk offer *creation* — a pasted sheet may add offers, not only edit them
-- Source: docs/16 §6.1.
-- =============================================================================

/*
 * A merchant onboarding a real catalogue has to add every offer by hand.
 *
 * `merchant_bulk_update_offers` skipped any row it could not match to an existing offer, with
 * `no_matching_offer` — correct for a stock-and-price sheet, and useless for the case that actually costs
 * a merchant its afternoon: two hundred SKUs BioCode already lists and no offers on any of them. The form
 * takes about forty seconds per offer.
 *
 * So the unmatched row becomes a **draft offer** and goes through the same `offers.review` approval as one
 * typed into the form. Nothing about the review model changes: a merchant still cannot publish supply, and
 * a reviewer still sees every new offer before a customer can buy it. What changes is the typing.
 *
 * ── Renamed, because "update" was the whole contract ──
 *
 * `merchant_bulk_upsert_offers`, and the old name is dropped rather than left as a wrapper. A function
 * called `update` that inserts is the kind of name that survives one refactor and lies for a year. This
 * restatement carries migration 40's SKU tie-break with it (docs/13 §X3, §X4 — a restated function is the
 * accumulation of every migration that touched it, and forgetting one silently reverts a fix).
 *
 * ── What a new offer is matched against ──
 *
 * An update matches the merchant's own `merchant_sku` first, then BioCode's variant `sku`. A *creation*
 * has no offer to read a `merchant_sku` from, so the key must be BioCode's: the variant `sku` or its
 * `barcode`. Which is why the page hands out a catalogue export — a merchant guessing at our codes is a
 * merchant filling its report with `unknown_sku`.
 *
 * And the variant must belong to a **published** product. Two reasons, and the second is the one that
 * matters: an offer on an unpublished product would sit on a page no customer can reach, and a lookup that
 * answered for drafts would turn this function into an oracle for probing whether BioCode is preparing to
 * list something. `p_create` exists so a merchant sending its nightly stock file can say "change what
 * exists, create nothing" and have a typo report itself rather than become an offer.
 */

drop function if exists public.merchant_bulk_update_offers(uuid, jsonb);

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
     -- The merchant's own code wins when both match, since that is what it typed.
     order by (lower(o.merchant_sku) = lower(v_sku)) desc
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
     order by (lower(pv.sku) = lower(v_sku)) desc
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

comment on function public.merchant_bulk_upsert_offers is
  'Applies stock, price, handling and threshold to many of one merchant''s offers, creating drafts for '
  'unmatched SKUs when p_create. Reports what it skipped. docs/16 §6.1.';

revoke all on function public.merchant_bulk_upsert_offers(uuid, jsonb, boolean) from public, anon;
grant execute on function public.merchant_bulk_upsert_offers(uuid, jsonb, boolean)
  to authenticated, service_role;

/*
 * BioCode's published catalogue as export rows, so a merchant creating offers in bulk has our SKUs.
 *
 * Every column here is already on the storefront — this is the same data a shopper reads, in the shape a
 * spreadsheet wants. Without it, bulk creation is a feature whose first requirement is that the merchant
 * already knows codes it has never been told, and `unknown_sku` becomes the normal outcome.
 *
 * `security invoker` deliberately: the anon read policy on `products` already restricts this to published
 * rows, so the function needs no privilege of its own and cannot become a way to read more than the
 * storefront shows.
 */
create or replace function public.catalogue_export()
returns table (
  sku text,
  barcode text,
  product_name text,
  variant_name text,
  price_cents int,
  in_stock boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    pv.sku,
    coalesce(pv.barcode, ''),
    coalesce(p.name->>'sq', p.name->>'en', ''),
    coalesce(pv.name->>'sq', pv.name->>'en', ''),
    pv.price_cents,
    /*
     * A subquery, not a join: `inventory_levels` is keyed by (variant_id, warehouse_id), so joining it
     * would return one row per warehouse and quietly duplicate every variant in the merchant's sheet.
     *
     * Worth telling a merchant, and not a secret — the product page already says "out of stock" to
     * anybody. Where BioCode is short is exactly where a merchant's offer wins the buy box, so this is
     * the most useful column in the file.
     */
    coalesce(
      (select sum(il.on_hand) from inventory_levels il where il.variant_id = pv.id),
      0
    ) > 0
  from product_variants pv
  join products p on p.id = pv.product_id
  where p.status = 'published'
    and p.deleted_at is null
    and pv.is_active
  order by coalesce(p.name->>'sq', p.name->>'en', ''), pv.position
  limit 5000;
$$;

comment on function public.catalogue_export is
  'BioCode''s published SKUs for a merchant building an offer sheet. docs/16 §6.1.';

grant execute on function public.catalogue_export() to authenticated, service_role;
