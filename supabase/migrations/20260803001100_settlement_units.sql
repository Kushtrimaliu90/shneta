-- =============================================================================
-- 33 · M12 · Settlement for many unit prices in one round trip
-- Source: docs/16 §5, §8.
-- =============================================================================

/*
 * What a merchant would receive for one unit at each of a set of retail prices.
 *
 * The offer form needs this for every variant in its picker: a merchant deciding what to ask for a
 * product has to see what BioCode will actually pay for it, and the answer differs per price. Twenty
 * separate `merchant_settlement` calls would be twenty round trips on a form page.
 *
 * ── Why it delegates instead of computing ──
 *
 * The arithmetic stays in `merchant_settlement`, which is the only place it lives (§8). This function
 * is a loop, not a second implementation — the moment it reimplemented `subtotal − commission −
 * shipping` there would be two versions of the number that appears on a statement, and they would
 * agree right up until one of them was changed.
 *
 * Distinct prices only, because the caller is de-duplicating a picker list and the same price
 * appearing four times is four identical answers.
 */
create or replace function public.merchant_settlement_units(
  p_merchant_id uuid,
  p_unit_prices int[]
)
returns table (unit_price_cents int, merchant_due_cents int)
language sql
stable
security definer
set search_path = public
as $$
  select
    price as unit_price_cents,
    (public.merchant_settlement(p_merchant_id, price) ->> 'merchant_due_cents')::int
      as merchant_due_cents
  from (select distinct unnest(p_unit_prices) as price) prices
  where price > 0
$$;

comment on function public.merchant_settlement_units is
  'Per-unit settlement for a set of retail prices, one round trip. Delegates to merchant_settlement. docs/16 §5.';

/*
 * Authenticated only, and it takes the merchant id as an argument — so it is worth being explicit
 * about what it does and does not leak. It returns nothing but arithmetic over `commission_pct` and
 * the shipping setting, both of which the merchant already reads from its own row under RLS. It
 * exposes no offer, no order and no other merchant's terms; the worst a caller can learn by passing
 * somebody else's id is that merchant's commission rate, which is why it stays off `anon`.
 *
 * A per-caller ownership check inside the function was considered and rejected: it would make the
 * function depend on `current_merchant_ids()` and therefore unusable by the admin screens that need
 * exactly this number for a merchant they are reviewing.
 */
revoke all on function public.merchant_settlement_units(uuid, int[]) from public, anon;
grant execute on function public.merchant_settlement_units(uuid, int[]) to authenticated, service_role;
