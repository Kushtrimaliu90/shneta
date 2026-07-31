-- =============================================================================
-- 08 · checkout_create_order — the single write path for orders
-- Source: docs/03 §8 and docs/07 §2/§4, with the correction in docs/13 §A1.
-- =============================================================================

/**
 * One validated cart line. Materialising the resolved set into an array is what makes the
 * two passes provably identical — see the note on the function below.
 */
create type checkout_line as (
  variant_id uuid,
  product_id uuid,
  quantity int,
  price_cents int,
  sku text,
  name_snapshot text,
  image_path text
);

/*
 * Atomic order creation: locks the cart and the stock rows, prices from the live catalog,
 * validates the coupon, computes totals, writes order + items + payment + ledger, redeems
 * the coupon and converts the cart — all in one transaction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * docs/13 §A1 — the defect this rewrite fixes.
 *
 * The original ran two independent passes over `cart_items`. Pass 1 (pricing and stock)
 * joined with `pv.is_active`, `p.status = 'published'` and `p.deleted_at is null`. Pass 2
 * (item snapshot and stock decrement) joined with none of them.
 *
 * A variant deactivated or a product unpublished between add-to-cart and checkout was
 * therefore excluded from `subtotal` — the customer was not charged for it — while still
 * being written as an order item and decremented from stock. Free goods, and `on_hand`
 * driven toward the `>= 0` check constraint, which aborts the transaction with an opaque
 * error rather than a message anyone can act on.
 *
 * Now the purchasable set is resolved exactly once into `v_lines`, and both passes iterate
 * that array. A cart line that no longer resolves raises `CART_ITEM_UNAVAILABLE:<sku>` up
 * front, so the UI can prune the line and say which product went away.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Totals are the canonical algorithm from docs/07 §2 and are mirrored in
 * `src/lib/money.ts`; `tests/unit/money.test.ts` asserts parity. Change one, change both.
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
             q.sku, q.name_snapshot, q.image_path
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

  -- Pass 1: lock stock, verify availability, price from the DB (never from the client).
  foreach v_line in array v_lines loop
    select on_hand into v_stock
      from inventory_levels
     where variant_id = v_line.variant_id and warehouse_id = v_warehouse
     for update;

    if coalesce(v_stock, 0) < v_line.quantity then
      raise exception 'OUT_OF_STOCK:%', v_line.sku;
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
  -- The `v_coupon.id is not null` guard is explicit rather than relying on field access
  -- against an unassigned %ROWTYPE variable evaluating to NULL.
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
      quantity, unit_price_cents, total_cents
    ) values (
      v_order_id, v_line.product_id, v_line.variant_id, v_line.name_snapshot,
      v_line.sku, v_line.image_path,
      v_line.quantity, v_line.price_cents, v_line.price_cents * v_line.quantity
    );

    update inventory_levels
       set on_hand = on_hand - v_line.quantity, updated_at = now()
     where variant_id = v_line.variant_id and warehouse_id = v_warehouse;

    insert into stock_movements (
      variant_id, warehouse_id, type, quantity, reference_type, reference_id, created_by
    ) values (
      v_line.variant_id, v_warehouse, 'sale', -v_line.quantity, 'order', v_order_id, v_cart.user_id
    );
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

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total_cents', v_total,
    -- docs/13 §B1 — placeOrder puts this in a 30-minute httpOnly cookie; the success
    -- page requires it. It must never appear in a URL.
    'access_token', v_access_token
  );
end $$;

revoke all on function public.checkout_create_order(
  uuid, text, text, jsonb, jsonb, uuid, payment_provider, text, text, text
) from public, anon;
grant execute on function public.checkout_create_order(
  uuid, text, text, jsonb, jsonb, uuid, payment_provider, text, text, text
) to authenticated, service_role;
