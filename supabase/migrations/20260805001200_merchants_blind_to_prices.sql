-- =============================================================================
-- Merchants stop being handed BioCode's prices and stock (owner decision, 2026-08-05)
--
-- `catalogue_export()` is the file and the API a merchant pulls to match their own SKUs against the
-- catalogue. It returned `price_cents` and `in_stock` for all 5000 rows. Both columns go.
--
-- ── What this does and does not achieve, stated plainly ──
--
-- It does **not** make prices secret, and nothing can. `product_variants` is world-readable for
-- published products — that is what serves the shop — so any visitor, merchant included, can read every
-- retail price from the storefront or straight off the anon API. Verified, not assumed.
--
-- What it removes is the *convenience*: a sorted, machine-readable price list of the whole catalogue,
-- handed over on request. Reading 91 prices off a website one at a time and downloading them as a CSV
-- are different activities, and only the second is something BioCode was doing for them.
--
-- Rival merchants' prices and stock were never exposed: `p_own_read on merchant_offers` scopes reads to
-- `current_merchant_ids()`, so a merchant has only ever seen their own offers.
--
-- ── `in_stock` was also broken, which is why this is a fix and not only a policy change ──
--
-- The function is `security invoker` and `inventory_levels` is staff-only, so the `sum(on_hand)`
-- subquery returned null for every non-staff caller, `coalesce(…, 0) > 0` was false, and every merchant
-- who pulled the catalogue was told BioCode is out of stock on all 71 published variants. The column's
-- own comment called it "the most useful column in the file". It has been wrong since it shipped
-- earlier today; removing it is the fix as well as the policy.
-- =============================================================================

/*
 * Dropped rather than replaced: `create or replace` cannot change a function's return type, and
 * `returns table` is part of it (docs/13 §X2).
 */
drop function if exists public.catalogue_export();

create or replace function public.catalogue_export()
returns table (
  sku text,
  barcode text,
  product_name text,
  variant_name text
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
    coalesce(pv.name->>'sq', pv.name->>'en', '')
  from product_variants pv
  join products p on p.id = pv.product_id
  where p.status = 'published'
    and p.deleted_at is null
    and pv.is_active
  order by coalesce(p.name->>'sq', p.name->>'en', ''), pv.position
  limit 5000;
$$;

comment on function public.catalogue_export is
  'Identifiers a merchant needs to match their own SKUs to the catalogue: code, barcode and names. No
   price and no stock — see the migration header for what that does and does not achieve.';
