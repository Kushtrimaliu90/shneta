-- =============================================================================
-- 35 · M12 · Checkout sources a line from a merchant when BioCode cannot
-- Source: docs/16 §6.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The resolved cart line grows a source
-- -----------------------------------------------------------------------------

/*
 * `alter type … add attribute` on a composite is legal inside a transaction (unlike `add value` on an
 * enum — docs/16 §2), and this type is used only as a plpgsql variable, so nothing depends on its
 * shape but the function below.
 */
alter type checkout_line add attribute merchant_offer_id uuid;

comment on type checkout_line is
  'One validated cart line, with the offer that will source it (null = BioCode). docs/16 §6.';

-- -----------------------------------------------------------------------------
-- Checkout, extended
-- -----------------------------------------------------------------------------

/*
 * The whole function is restated rather than patched, because `create or replace function` has no
 * other form. Everything outside the two stock passes is unchanged from migration 08 — the
 * unavailable-line check, the coupon rules, the totals algorithm, the payment row, the redemption and
 * the cart conversion are all byte-identical, and `tests/unit/money.test.ts` still asserts parity
 * with `src/lib/money.ts`.
 *
 * What changed:
 *
 *   · Pass 1 asks BioCode first and falls through to the buy box. A line that neither can cover still
 *     raises `OUT_OF_STOCK:<sku>`, so the failure the UI already handles is unchanged.
 *   · Pass 2 decrements whichever source pass 1 chose, and records `merchant_offer_id` on the item.
 *
 * **Pricing is untouched.** The line is priced from `product_variants.price_cents` whoever supplies
 * it — the canonical price is the only customer-facing price (docs/16 §5), and the offer's own
 * `price_cents` is what the merchant asks BioCode, which is a settlement input and not a shelf price.
 */
create or replace function public.checkout_create_order(
  p_cart_id uuid,
  p_email text,
  p_phone text,
  p_shipping_address jsonb,
  p_billing_address jsonb,
  p_shipping_method_id uuid,
  p_payment_provider payment_provider,
  p_coupon_code text default null,
  p_customer_note text default null,
  p_locale text default 'sq'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cart carts%rowtype;
  v_method shipping_methods%rowtype;
  v_coupon coupons%rowtype;
  v_warehouse uuid;
  v_lines checkout_line[];
  v_line checkout_line;
  v_unavailable_sku text;
  v_stock int;
  v_subtotal int := 0;
  v_discount int := 0;
  v_shipping int := 0;
  v_tax int := 0;
  v_total int := 0;
  v_rate numeric;
  v_order_id uuid;
  v_order_number text;
  v_access_token text;
  v_offer record;
  v_index int;
begin
  if p_payment_provider not in ('cod','bank_pos') then
    raise exception 'PROVIDER_UNAVAILABLE';
  end if;
  if p_locale not in ('sq','en') then
    raise exception 'INVALID_LOCALE';
  end if;

  -- Locking the cart is what makes double-submit safe: the second call finds it converted.
  select * into v_cart from carts where id = p_cart_id and status = 'active' for update;
  if not found then raise exception 'CART_NOT_FOUND'; end if;

  if not is_service_role() and v_cart.user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_method
    from shipping_methods where id = p_shipping_method_id and is_active;
  if not found then raise exception 'SHIPPING_METHOD_INVALID'; end if;

  select id into v_warehouse from warehouses where is_default limit 1;
  if v_warehouse is null then raise exception 'NO_DEFAULT_WAREHOUSE'; end if;

  ------------------------------------------------------------------------------
  -- Any cart line that no longer resolves to a purchasable variant stops checkout
  -- with a message the UI can act on, instead of silently shipping it for free.
  ------------------------------------------------------------------------------
  select coalesce(pv.sku, ci.variant_id::text) into v_unavailable_sku
    from cart_items ci
    left join product_variants pv on pv.id = ci.variant_id
   where ci.cart_id = p_cart_id
     and not exists (
       select 1
         from product_variants v
         join products p on p.id = v.product_id
        where v.id = ci.variant_id
          and v.is_active
          and p.status = 'published'
          and p.deleted_at is null
     )
   limit 1;

  if v_unavailable_sku is not null then
    raise exception 'CART_ITEM_UNAVAILABLE:%', v_unavailable_sku;
  end if;

  ------------------------------------------------------------------------------
  -- Resolve the purchasable set ONCE. Ordered by variant_id so concurrent
  -- checkouts always take inventory locks in the same order and cannot deadlock.
  ------------------------------------------------------------------------------
  select array_agg(
           row(
             q.variant_id, q.product_id, q.quantity, q.price_cents,
             q.sku, q.name_snapshot, q.image_path, null::uuid
           )::checkout_line
           order by q.variant_id
         )
    into v_lines
    from (
      select ci.variant_id,
             p.id as product_id,
             ci.quantity,
             pv.price_cents,
             pv.sku,
             coalesce(p.name->>p_locale, p.name->>'sq', pv.sku) as name_snapshot,
             (select storage_path from product_images pi
               where pi.product_id = p.id order by pi.position limit 1) as image_path
        from cart_items ci
        join product_variants pv on pv.id = ci.variant_id and pv.is_active
        join products p on p.id = pv.product_id
                       and p.status = 'published'
                       and p.deleted_at is null
       where ci.cart_id = p_cart_id
    ) q;

  if v_lines is null or array_length(v_lines, 1) is null then
    raise exception 'CART_EMPTY';
  end if;

  ------------------------------------------------------------------------------
  -- Pass 1: lock stock, verify availability, price from the DB (never from the client).
  --
  -- BioCode first. A merchant offer is a fallback source, not a competitor on the same shelf, so a
  -- variant BioCode can ship never reaches a merchant however cheap the offer (docs/16 §1).
  ------------------------------------------------------------------------------
  for v_index in 1 .. array_length(v_lines, 1) loop
    v_line := v_lines[v_index];

    select on_hand into v_stock
      from inventory_levels
     where variant_id = v_line.variant_id and warehouse_id = v_warehouse
     for update;

    if coalesce(v_stock, 0) < v_line.quantity then
      /*
       * The buy box, resolved here rather than trusted from the page.
       *
       * The same ordering as `variant_buy_box` — cheapest, then better-rated, then oldest — and
       * deliberately not a call to it: that function is `stable` and returns bucketed stock, so it
       * cannot take the row lock this needs. `for update` on the offer is what makes the reservation
       * safe against a second checkout for the same last unit.
       */
      select o.id, o.merchant_id, o.stock_on_hand
        into v_offer
        from merchant_offers o
        join merchants m on m.id = o.merchant_id
       where o.variant_id = v_line.variant_id
         and o.status = 'approved'
         and m.status = 'approved'
         and o.stock_on_hand >= v_line.quantity
       order by o.price_cents asc, m.rating_avg desc, o.created_at asc, o.id asc
       limit 1
         for update of o;

      if v_offer.id is null then
        raise exception 'OUT_OF_STOCK:%', v_line.sku;
      end if;

      v_line.merchant_offer_id := v_offer.id;
      v_lines[v_index] := v_line;
    end if;

    v_subtotal := v_subtotal + v_line.price_cents * v_line.quantity;
  end loop;

  if v_subtotal = 0 then raise exception 'CART_EMPTY'; end if;

  ------------------------------------------------------------------------------
  -- Coupon. Validated only here so codes cannot be enumerated (docs/07 §9).
  ------------------------------------------------------------------------------
  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    select * into v_coupon
      from coupons
     where code = trim(p_coupon_code)::extensions.citext
       and is_active
       and (starts_at is null or starts_at <= now())
       and (ends_at is null or ends_at >= now())
     for update;

    if not found then raise exception 'COUPON_INVALID'; end if;

    if v_coupon.min_subtotal_cents is not null and v_subtotal < v_coupon.min_subtotal_cents then
      raise exception 'COUPON_MIN_NOT_MET';
    end if;

    if v_coupon.max_uses is not null
       and (select count(*) from coupon_redemptions where coupon_id = v_coupon.id) >= v_coupon.max_uses
    then
      raise exception 'COUPON_EXHAUSTED';
    end if;

    if v_cart.user_id is not null and v_coupon.max_uses_per_user is not null
       and (select count(*) from coupon_redemptions
             where coupon_id = v_coupon.id and user_id = v_cart.user_id) >= v_coupon.max_uses_per_user
    then
      raise exception 'COUPON_ALREADY_USED';
    end if;

    v_discount := case v_coupon.type
      when 'percentage' then (v_subtotal * v_coupon.value) / 100   -- integer division == floor
      when 'fixed'      then least(v_coupon.value, v_subtotal)
      else 0
    end;
  end if;

  -- docs/07 §2 — the free-over threshold is tested against subtotal − discount.
  v_shipping := case
    when v_coupon.id is not null and v_coupon.type = 'free_shipping' then 0
    when v_method.free_over_cents is not null
     and (v_subtotal - v_discount) >= v_method.free_over_cents then 0
    else v_method.price_cents
  end;

  select coalesce((value->>'rate')::numeric, 18) into v_rate from settings where key = 'tax';

  v_total := v_subtotal - v_discount + v_shipping;
  v_tax := round(v_total * coalesce(v_rate, 18) / (100 + coalesce(v_rate, 18)));

  ------------------------------------------------------------------------------
  -- Create the order
  ------------------------------------------------------------------------------
  insert into orders (
    user_id, email, phone, status, payment_status, currency,
    subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents,
    coupon_id, coupon_code, shipping_method, shipping_address, billing_address,
    customer_note, locale
  ) values (
    v_cart.user_id, lower(p_email), p_phone, 'pending', 'pending', 'EUR',
    v_subtotal, v_discount, v_shipping, v_tax, v_total,
    v_coupon.id, v_coupon.code,
    jsonb_build_object(
      'id', v_method.id, 'name', v_method.name, 'price_cents', v_shipping,
      'min_days', v_method.min_days, 'max_days', v_method.max_days
    ),
    p_shipping_address, coalesce(p_billing_address, p_shipping_address),
    p_customer_note, p_locale
  )
  returning id, order_number, access_token
       into v_order_id, v_order_number, v_access_token;

  -- Pass 2: the SAME lines. Locks from pass 1 are still held.
  foreach v_line in array v_lines loop
    insert into order_items (
      order_id, product_id, variant_id, name_snapshot, sku, image_path,
      quantity, unit_price_cents, total_cents, merchant_offer_id
    ) values (
      v_order_id, v_line.product_id, v_line.variant_id, v_line.name_snapshot,
      v_line.sku, v_line.image_path,
      v_line.quantity, v_line.price_cents, v_line.price_cents * v_line.quantity,
      v_line.merchant_offer_id
    );

    if v_line.merchant_offer_id is null then
      update inventory_levels
         set on_hand = on_hand - v_line.quantity, updated_at = now()
       where variant_id = v_line.variant_id and warehouse_id = v_warehouse;

      insert into stock_movements (
        variant_id, warehouse_id, type, quantity, reference_type, reference_id, created_by
      ) values (
        v_line.variant_id, v_warehouse, 'sale', -v_line.quantity, 'order', v_order_id, v_cart.user_id
      );
    else
      /*
       * The merchant's reservation. No `stock_movements` row: that ledger is BioCode's warehouse and
       * its invariant is that the sum of movements equals `on_hand` (docs/13 §A7). A merchant's stock
       * is a number the merchant maintains, and its history is the fulfilments it was reserved for.
       */
      update merchant_offers
         set stock_on_hand = stock_on_hand - v_line.quantity, updated_at = now()
       where id = v_line.merchant_offer_id;
    end if;
  end loop;

  insert into payments (order_id, provider, status, amount_cents)
  values (v_order_id, p_payment_provider, 'pending', v_total);

  if v_coupon.id is not null then
    insert into coupon_redemptions (coupon_id, user_id, order_id)
    values (v_coupon.id, v_cart.user_id, v_order_id);
  end if;

  update carts set status = 'converted' where id = p_cart_id;

  insert into order_events (order_id, type, message, is_customer_visible)
  values (v_order_id, 'created', 'Order placed', true);

  /*
   * Split into fulfilments before returning, so the order is never observable in a state where its
   * lines have no fulfiller. Called here rather than from a trigger because a trigger on `orders`
   * would fire before the items exist.
   */
  perform public.route_order(v_order_id);

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total_cents', v_total,
    'access_token', v_access_token
  );
end $$;

revoke all on function public.checkout_create_order(
  uuid, text, text, jsonb, jsonb, uuid, payment_provider, text, text, text
) from public, anon;
grant execute on function public.checkout_create_order(
  uuid, text, text, jsonb, jsonb, uuid, payment_provider, text, text, text
) to authenticated, service_role;
