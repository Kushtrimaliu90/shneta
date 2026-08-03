-- =============================================================================
-- 28 · M12 · The COD amount reads from `payments`, not from `orders`
-- Source: docs/16 §3, §8; docs/13 §W1.
-- =============================================================================

/*
 * Third and last correction to `merchant_fulfilment_view`: **`orders` has no `payment_provider`
 * column.** The provider lives on `payments`, one row per attempt, because an order can be paid
 * more than once — a failed card attempt followed by cash on delivery is two rows and one order.
 *
 * That distinction matters for what this function returns. "Is this cash on delivery?" is a
 * question about the *payment*, and the honest answer is "is there a COD payment row that has not
 * failed", not "what does the order say" — the order says nothing.
 *
 * `exists` rather than a join, so an order with two payment rows cannot duplicate the fulfilment
 * or make the amount depend on which row sorted first.
 *
 * Worth recording why all three of these corrections were needed (docs/13 §W1): every one was a
 * column name inside a plpgsql string. Postgres validates those at first execution, not at
 * `create`, so all three migrations applied cleanly and the function was broken until the isolation
 * suite called it. Three rounds of the same class of error is an argument for reading the schema
 * before writing the function, which is what the brief's column names invited me not to do.
 */

create or replace function public.merchant_fulfilment_view(p_fulfilment_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f record;
  o record;
  result jsonb;
  is_assigned boolean;
  is_cod boolean;
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

  select exists (
    select 1 from payments p
    where p.order_id = o.id
      and p.provider = 'cod'
      and p.status <> 'failed'
  ) into is_cod;

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
     * candidates on the routing screen and only one will ever ship it — a candidate has no reason
     * to hold a customer's address and phone number.
     *
     * `- 'email'` on the address too: a shipping address jsonb written by an older checkout may
     * carry one, and this function must not become the leak.
     */
    'ship_to', case
      when is_assigned then jsonb_build_object(
        'name', o.shipping_address->>'full_name',
        'phone', o.phone,
        'address', o.shipping_address - 'email'
      )
      else null
    end,
    /*
     * **This fulfilment's subtotal, never the order total** (docs/16 §3). A merchant packing two of
     * five lines must not learn what the customer paid altogether — and on a COD order the amount
     * it is told to expect is the amount its own lines come to.
     */
    'cod_amount_cents', case when is_cod then f.items_subtotal_cents else 0 end
  ) into result;

  return result;
end $$;

comment on function public.merchant_fulfilment_view is
  'The only read path from the merchant portal into order data. Address released once assigned. docs/16 §3.';
