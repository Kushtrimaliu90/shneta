-- =============================================================================
-- 20 · `apply_stock_movement` raises the error it promised
-- Source: docs/06 §8, correcting migration 04.
-- =============================================================================

/*
 * Migration 04 says: "The CHECK constraint would also catch this, but a named error is
 * actionable in the UI." It was wrong about which one fires.
 *
 * `inventory_levels.on_hand >= 0` is a column CHECK, so it is evaluated *by the UPDATE itself* —
 * before control returns to the function and reaches `if v_on_hand < 0`. So a warehouse manager
 * adjusting stock below zero got:
 *
 *   new row for relation "inventory_levels" violates check constraint "inventory_levels_on_hand_check"
 *
 * which the action mapped to "Something went wrong" because it is not `INSUFFICIENT_STOCK`. The
 * named error was unreachable, and the operator was told nothing about what they had done.
 *
 * Found by the M10 integration test asserting the message rather than only the failure — which
 * is the point of asserting messages: a test for "it errors" would have passed on this for the
 * life of the project.
 *
 * The fix is to check before writing. The CHECK constraint stays as the backstop it should
 * always have been: this function is not the only way a row could go negative, and a constraint
 * that never fires is still the thing that makes the invariant true.
 */
create or replace function public.apply_stock_movement(
  p_variant_id uuid,
  p_warehouse_id uuid,
  p_type stock_movement_type,
  p_quantity int,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_batch_number text default null,
  p_expiry_date date default null,
  p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_on_hand int;
begin
  if not (is_service_role() or has_any_role(array['warehouse_manager','product_manager']::user_role[])) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  insert into inventory_levels (variant_id, warehouse_id, on_hand)
  values (p_variant_id, p_warehouse_id, 0)
  on conflict (variant_id, warehouse_id) do nothing;

  /*
   * Locked before the check, so two concurrent movements cannot both read "5 on hand" and both
   * decide that removing 4 is fine. Without `for update` this would be a check-then-act race,
   * and the CHECK constraint would then fire on the loser with the unhelpful message this
   * migration exists to remove.
   */
  select on_hand into v_on_hand
    from inventory_levels
   where variant_id = p_variant_id and warehouse_id = p_warehouse_id
     for update;

  if v_on_hand + p_quantity < 0 then
    raise exception 'INSUFFICIENT_STOCK' using errcode = '23514';
  end if;

  update inventory_levels
     set on_hand = on_hand + p_quantity, updated_at = now()
   where variant_id = p_variant_id and warehouse_id = p_warehouse_id;

  insert into stock_movements (
    variant_id, warehouse_id, type, quantity,
    batch_number, expiry_date, reference_type, reference_id, note, created_by
  ) values (
    p_variant_id, p_warehouse_id, p_type, p_quantity,
    p_batch_number, p_expiry_date, p_reference_type, p_reference_id, p_note, auth.uid()
  );
end $$;

revoke all on function public.apply_stock_movement(uuid, uuid, stock_movement_type, int, text, uuid, text, date, text) from public, anon;
grant execute on function public.apply_stock_movement(uuid, uuid, stock_movement_type, int, text, uuid, text, date, text) to authenticated, service_role;
