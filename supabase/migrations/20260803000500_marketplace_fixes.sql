-- =============================================================================
-- 27 · M12 · Two functions corrected against the real column names
-- Source: docs/16 §3; docs/13 §W1.
-- =============================================================================

/*
 * Migration 26 wrote both of these against the column names in the M12 brief rather than the ones
 * in this database, and both failed at runtime with `42703 undefined_column` — caught by the
 * isolation suite, which is exactly what it is for.
 *
 *   · `audit_logs` has **`entity_type`**, not `entity`.
 *   · `order_items` has **`name_snapshot`** (text) and **`total_cents`** — there is no
 *     `product_name`, no `variant_name` and no `line_total_cents`. Names are snapshotted as a
 *     single string at checkout, deliberately: an order line has to keep reading correctly after
 *     the product is renamed or deleted (docs/07).
 *
 * Worth noting that neither error was reachable from a type check. Both are strings inside
 * plpgsql, which Postgres validates at first execution rather than at `create`, so the migration
 * applied cleanly and the functions were broken until something called them.
 */

create or replace function public.guard_merchant_self_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_service_role() or has_any_role(array['admin']::user_role[]) then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.commission_pct is distinct from old.commission_pct
     or new.ships_own is distinct from old.ships_own
     or new.collects_cash is distinct from old.collects_cash
     or new.slug is distinct from old.slug
     or new.business_no is distinct from old.business_no
     or new.legal_name is distinct from old.legal_name
     or new.rating_avg is distinct from old.rating_avg
     or new.rating_count is distinct from old.rating_count
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at
  then
    raise exception 'MERCHANT_FIELD_FORBIDDEN' using errcode = '42501';
  end if;

  /*
   * A bank change is permitted and always leaves a trail. `iban` is the field an account takeover
   * would target, and only the last four digits are recorded — an audit row exists to say that
   * something changed and who changed it, not to become a second copy of the bank details.
   */
  if new.iban is distinct from old.iban or new.bank_name is distinct from old.bank_name then
    insert into audit_logs (actor_id, action, entity_type, entity_id, after)
    values (
      auth.uid(), 'merchant.bank_changed', 'merchant', new.id::text,
      jsonb_build_object('bank_name', new.bank_name, 'iban_last4', right(coalesce(new.iban, ''), 4))
    );
  end if;

  return new;
end $$;

/*
 * The one read path into order data (docs/16 §3), against the real `order_items` shape.
 *
 * Everything else about it is unchanged and worth restating, because it is the whole reason this
 * function exists rather than a view: the return shape is fixed, so a column added to `orders`
 * later cannot widen what a merchant sees. A view with `select *` would.
 */
create or replace function public.merchant_fulfilment_view(p_fulfilment_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f record;
  o record;
  result jsonb;
  is_assigned boolean;
begin
  select * into f
  from order_fulfilments
  where id = p_fulfilment_id
    and merchant_id = any (current_merchant_ids());

  -- Null rather than an exception: a merchant probing another's id learns nothing from silence.
  if f is null then
    return null;
  end if;

  select * into o from orders where id = f.order_id;
  if o is null then
    return null;
  end if;

  is_assigned := f.status <> 'unassigned';

  select jsonb_build_object(
    'fulfilment', jsonb_build_object(
      'id', f.id,
      'status', f.status,
      'assigned_at', f.assigned_at,
      'accepted_at', f.accepted_at,
      'packed_at', f.packed_at,
      'shipped_at', f.shipped_at,
      'carrier', f.carrier,
      'tracking_code', f.tracking_code,
      'items_subtotal_cents', f.items_subtotal_cents,
      'merchant_due_cents', f.merchant_due_cents
    ),
    /*
     * The order number, and deliberately nothing else from `orders`. A merchant needs a reference
     * both sides can say out loud to BioCode support; it does not need the email, the totals, the
     * coupon or the customer's account.
     */
    'order_number', o.order_number,
    'placed_at', o.placed_at,
    'delivery_method', o.shipping_method,
    'items', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'name', oi.name_snapshot,
          'sku', oi.sku,
          'quantity', oi.quantity,
          'unit_price_cents', oi.unit_price_cents,
          'total_cents', oi.total_cents
        ) order by oi.name_snapshot)
        from order_items oi
        where oi.fulfilment_id = f.id
      ),
      '[]'::jsonb
    ),
    /*
     * Released only once the fulfilment is assigned. Before that the merchant is one of several
     * candidates on the routing screen and only one of them will ever ship it — a candidate has no
     * reason to be holding a customer's address and phone number.
     *
     * `- 'email'` on the address as well, because a shipping address jsonb written by an older
     * checkout may carry one and this function must not become the leak.
     */
    'ship_to', case
      when is_assigned then jsonb_build_object(
        'name', o.shipping_address->>'full_name',
        'phone', o.phone,
        'address', o.shipping_address - 'email'
      )
      else null
    end,
    'cod_amount_cents', case
      when o.payment_provider = 'cod' then f.items_subtotal_cents
      else 0
    end
  ) into result;

  return result;
end $$;

comment on function public.merchant_fulfilment_view is
  'The only read path from the merchant portal into order data. Address released once assigned. docs/16 §3.';
