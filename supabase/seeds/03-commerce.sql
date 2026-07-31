-- =============================================================================
-- Commerce fixtures (docs/11 §8) — LOCAL AND STAGING ONLY.
--
-- Coupons only. Order / subscription / wishlist fixtures wait on
-- `scripts/seed-users.ts`, because they reference the fixed auth UUIDs it mints
-- (docs/11 §10) — tracked in docs/14 §3.
--
-- Idempotent: fixed UUIDs plus `on conflict do update`.
--
-- These four exist to make every branch of the checkout RPC's coupon block
-- reachable from a test (`supabase/migrations/20260731000800_rpc_checkout.sql`):
--   · WELCOME10 — the happy path, percentage
--   · FALAS     — free_shipping, which zeroes delivery instead of the subtotal
--   · EXPIRED5  — outside its window, so `COUPON_INVALID` is exercised
--   · SUB-10    — is_system, hidden from /offers but ACTIVE (docs/13 §A3)
-- =============================================================================

insert into coupons (
  id, code, type, value, min_subtotal_cents, max_uses, max_uses_per_user,
  starts_at, ends_at, is_active, is_system, note
) values
  (
    'd0000000-0000-4000-8000-000000000001', 'WELCOME10', 'percentage', 10,
    2000,    -- €20 minimum, so COUPON_MIN_NOT_MET is reachable with a single cheap item
    null,
    1,       -- one per account; guests are not counted, because the RPC's per-user check
             -- needs a user_id and a guest has none
    null, null, true, false,
    'First-order welcome discount. Public, listed on /offers.'
  ),
  (
    'd0000000-0000-4000-8000-000000000002', 'FALAS', 'free_shipping', 0,
    3000, null, null, null, null, true, false,
    'Free delivery over EUR 30. "Falas" = free.'
  ),
  (
    'd0000000-0000-4000-8000-000000000003', 'EXPIRED5', 'fixed', 500,
    null, null, null,
    -- A literal past window rather than `now() - interval …`: this stays expired for good
    -- and keeps the seed byte-identical across resets.
    '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
    true,    -- deliberately still active: the RPC must reject it on the WINDOW, not the flag
    false,
    'Expired on purpose — fixture for the COUPON_INVALID path.'
  ),
  (
    'd0000000-0000-4000-8000-000000000004', 'SUB-10', 'percentage', 10,
    null, null, null, null, null,
    true,    -- docs/13 §A3 — an inactive system coupon could never be applied
    true,
    'Subscription discount. Hidden from /offers by is_system, never by is_active.'
  )
on conflict (id) do update set
  code               = excluded.code,
  type               = excluded.type,
  value              = excluded.value,
  min_subtotal_cents = excluded.min_subtotal_cents,
  max_uses           = excluded.max_uses,
  max_uses_per_user  = excluded.max_uses_per_user,
  starts_at          = excluded.starts_at,
  ends_at            = excluded.ends_at,
  is_active          = excluded.is_active,
  is_system          = excluded.is_system,
  note               = excluded.note;
