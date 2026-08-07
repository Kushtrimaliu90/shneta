-- =============================================================================
-- 72 · Audit a bank change whoever makes it
-- Source: found while giving admins the ability to edit settlement details.
-- =============================================================================

/*
 * ── The gap ──
 *
 * `guard_merchant_self_update` does two jobs: it refuses field changes a merchant may not make, and
 * it writes a `merchant.bank_changed` audit row when the IBAN or bank name moves. Its own comment
 * says the audit exists because "a trigger cannot be bypassed by a second code path".
 *
 * It could. The privilege check returned early:
 *
 *     if is_service_role() or has_any_role(array['admin']) then
 *       return new;                      -- ← and the audit below never runs
 *     end if;
 *
 * So the trail was written for the one actor whose changes are least alarming — the merchant editing
 * their own details — and skipped for the two whose changes are most: an admin, and anything holding
 * the service key. Changing where a merchant's money is sent is the textbook account-takeover move,
 * and it was the privileged path that left no trigger-level record of it.
 *
 * Nobody had noticed because no admin path to those fields existed yet. Adding one is what surfaced
 * it, and the fix has to land first — an admin bank-edit screen on top of a trigger that does not
 * audit admins would be building the hole in.
 *
 * ── The fix ──
 *
 * Audit first, then decide what to refuse. Restated in full rather than patched, because
 * `create or replace` on an accumulated function is the sum of every migration that touched it
 * (docs/13 §X3) — the body below is migration 21's with the two blocks swapped and nothing else
 * changed.
 *
 * The actor can be null here, which is correct rather than sloppy: a service-role write has no
 * `auth.uid()`, and a row saying "the bank details changed and no signed-in user did it" is exactly
 * the row someone should want to see.
 */
create or replace function public.guard_merchant_self_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  /*
   * Unconditional, and deliberately before the privilege check. Only the last four digits are
   * recorded — the audit says that something changed and who changed it; it is not a second copy of
   * the bank details.
   */
  if new.iban is distinct from old.iban or new.bank_name is distinct from old.bank_name then
    insert into audit_logs (actor_id, action, entity_type, entity_id, after)
    values (
      auth.uid(), 'merchant.bank_changed', 'merchant', new.id::text,
      jsonb_build_object('bank_name', new.bank_name, 'iban_last4', right(coalesce(new.iban, ''), 4))
    );
  end if;

  -- Settlement method travels with the bank details and is worth the same trail: switching a
  -- merchant to cash is how you would stop a transfer nobody wanted questioned.
  if new.settlement_method is distinct from old.settlement_method then
    insert into audit_logs (actor_id, action, entity_type, entity_id, after)
    values (
      auth.uid(), 'merchant.settlement_changed', 'merchant', new.id::text,
      jsonb_build_object('from', old.settlement_method, 'to', new.settlement_method)
    );
  end if;

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

  return new;
end $$;
