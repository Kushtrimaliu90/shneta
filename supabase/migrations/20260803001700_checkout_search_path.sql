-- =============================================================================
-- 39 · M12 · Restore the citext search_path on checkout_create_order
-- Source: docs/13 §I (the original fix, migration 13) and §X3 (how it came back).
-- =============================================================================

/*
 * Migration 35 restated `checkout_create_order` in full to add merchant sourcing, and wrote
 * `set search_path = public` — which is what migration 08 said and what migration 13 had already
 * corrected to `public, extensions`.
 *
 * ── Why one missing schema breaks coupons and nothing else ──
 *
 * `coupons.code` is `extensions.citext`. The comparison in the function is
 * `code = trim(p_coupon_code)::extensions.citext`. The **cast** is schema-qualified and resolves
 * fine; the **`=` operator** for citext also lives in `extensions` and cannot be qualified inside an
 * expression. With `extensions` off the search_path, Postgres cannot see `=(citext, citext)` — and
 * because citext is binary-coercible to text, it silently falls back to `=(text, text)`. No error, no
 * warning: just a case-sensitive comparison, so `welcome10` stops matching `WELCOME10`.
 *
 * ── What this says about restating a 250-line function ──
 *
 * `create or replace function` has no partial form, so extending the checkout meant reproducing every
 * line of it — and reproducing it from the migration that *defined* it silently discarded a correction
 * applied five migrations later. The function's current definition is not any one file; it is the
 * accumulation, and only the database knows it.
 *
 * The test that caught it (`matches a coupon code case-insensitively (citext)`) exists precisely
 * because this was fixed once before, and its docstring says so. That is the whole argument for
 * writing the regression test with the fix rather than after it.
 *
 * `alter function … set search_path` rather than another full restatement, for the same reason
 * migration 13 chose it: the body is long, and touching it again to change one clause is another
 * chance to lose something else.
 */
alter function public.checkout_create_order(
  uuid, text, text, jsonb, jsonb, uuid, payment_provider, text, text, text
) set search_path = public, extensions;
