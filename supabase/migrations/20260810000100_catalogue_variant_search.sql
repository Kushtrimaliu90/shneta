-- 78 · The merchant offer picker could not see, or find, most of the catalogue
--
-- Reported as "the product list does not contain all the products". Two independent faults, and the
-- second is the one that made the first unrecoverable.
--
-- 1. `searchCatalogVariants` capped at **20** rows ordered by `sku`. Measured against production: 72
--    live variants across 15 brands, of which the unsearched page reached 20 variants across **6**
--    brands — BIOCODE, BioTechUSA, Garden of Life, Jamieson, Lamberts, MyProtein. Every brand whose
--    SKU sorts later, NOW Foods and Optimum Nutrition among them, was simply absent.
--
-- 2. The search box could not rescue you from that, because it searched the wrong column. The query
--    built `.or('sku.ilike.X,name->>sq.ilike.X,name->>en.ilike.X')` against `product_variants`, and a
--    bare column inside a PostgREST `.or()` resolves to the **queried table** — so `name` was the
--    variant's size label ("750 ml e zezë", "60 kapsula"), never the product title. `product_variants.name`
--    is jsonb, so it did not error; it silently matched nothing. Measured: `whey` matches 0 variant
--    names and 8 product names.
--
-- No argument to `.or()` fixes the second one. PostgREST cannot OR a parent column together with an
-- embedded resource, so the product title has to *be* a top-level column — which is what this view is
-- for. `src/features/inventory/queries.ts` already flattens the same join for the same reason.
--
-- `security_invoker` so the merchant's own session evaluates RLS. That matters beyond tidiness: the
-- read policy on `brands` is `is_active and deleted_at is null`, so deactivating a brand withdraws its
-- variants from every merchant's picker. That is the owner's supply lever (docs/14 §20 item 10), and an
-- inner join keeps it working rather than routing around it with a definer view.
create or replace view public.v_catalogue_variant_search with (security_invoker = on) as
  select
    pv.id           as variant_id,
    pv.product_id,
    pv.sku,
    pv.barcode,
    pv.name         as variant_name,
    pv.price_cents,
    pv.position,
    p.slug          as product_slug,
    p.name          as product_name,
    b.name          as brand_name,
    /*
     * One lower-cased haystack instead of six OR'd predicates.
     *
     * A merchant types what is written on the box, and cannot know whether "Gold Standard" is the
     * product name, the variant name or part of the brand. Matching one concatenation means the
     * search answers the question actually being asked — "do you list this thing?" — rather than
     * making the merchant guess which field BioCode filed it under. It also keeps the client query a
     * single `ilike`, so there is no `.or()` string to get subtly wrong a second time.
     */
    lower(
      concat_ws(
        ' ',
        b.name,
        p.name ->> 'sq',
        p.name ->> 'en',
        pv.name ->> 'sq',
        pv.name ->> 'en',
        pv.sku,
        pv.barcode
      )
    )               as search_text,
    /* Brand, then product, then the variant's own order — so a select groups the way a shelf does. */
    lower(concat_ws(' ', b.name, p.name ->> 'sq')) as sort_key
  from product_variants pv
  join products p on p.id = pv.product_id
  join brands   b on b.id = p.brand_id
 where pv.is_active
   and p.status = 'published'
   and p.deleted_at is null;

comment on view public.v_catalogue_variant_search is
  'Published, active variants flattened so the merchant offer picker can search product name, brand, '
  'variant name, SKU and barcode in one predicate. security_invoker: RLS on products and brands still '
  'applies, so a deactivated brand leaves the picker. docs/16 §5.';

grant select on public.v_catalogue_variant_search to authenticated, service_role;
