-- =============================================================================
-- 44 · M12 · The listing counts merchant supply too
-- Source: docs/16 §1; the gap is docs/13 §X7.
-- =============================================================================

/*
 * ── The last place that still thought BioCode was the only supplier ──
 *
 * `search_products.in_stock` was `sum(inventory_levels.on_hand) > 0` — "can BioCode ship this?" — which
 * was the whole question until migration 35 taught checkout to source a line from a merchant.
 *
 * Three consequences, every one of them visible to a shopper:
 *
 *   1. **The out-of-stock badge lied.** A product a merchant was holding read as unavailable on the shop
 *      grid and buyable on its own page, because the PDP had already been corrected.
 *   2. **The in-stock filter hid it.** `p_in_stock_only` reads this column, so filtering to "in stock"
 *      excluded exactly the products the marketplace exists to sell.
 *   3. **The sort buried it.** Out-of-stock products sink (docs/07 §11), so a merchant-supplied product
 *      fell to the last page while being perfectly buyable.
 *
 * The third is how it surfaced: taking two seeded variants to zero BioCode stock — so the demo merchants
 * would have something to win — dropped both products off the first page and broke a catalogue test that
 * asserts the price ordering. The test was right; the listing was wrong.
 *
 * ── How this file was written, and why that matters ──
 *
 * The body below is migration 09's, **copied verbatim** by a script, with one expression replaced. The
 * first attempt retyped the signature from memory and lost `p_forms product_form[]`, `brand_id`,
 * `published_at` and the `product_form` return type; Postgres refused it, which was the lucky outcome.
 * docs/13 §X3 is the unlucky one — a retyped function that applied cleanly and silently reverted a fix
 * five migrations old.
 */
create or replace function public.search_products(
  p_query text default null,
  p_category_slugs text[] default null,
  p_brand_slugs text[] default null,
  p_goal_slugs text[] default null,
  p_ingredient_slugs text[] default null,
  p_dietary_tags text[] default null,
  p_forms product_form[] default null,
  p_min_price_cents int default null,
  p_max_price_cents int default null,
  p_min_rating numeric default null,
  p_in_stock_only boolean default false,
  p_on_sale_only boolean default false,
  p_sort text default 'relevance',
  p_limit int default 24,
  p_offset int default 0
)
returns table (
  product_id uuid,
  slug text,
  name jsonb,
  subtitle jsonb,
  brand_id uuid,
  brand_name text,
  brand_slug text,
  form product_form,
  dietary_tags text[],
  rating_avg numeric,
  rating_count int,
  is_featured boolean,
  published_at timestamptz,
  variant_id uuid,
  sku text,
  price_cents int,
  compare_at_price_cents int,
  image_path text,
  in_stock boolean,
  total_count bigint
)
language sql stable security definer set search_path = public, extensions as $$
  with normalized as (
    select nullif(trim(coalesce(p_query, '')), '') as q
  ),
  base as (
    select
      p.id, p.slug, p.name, p.subtitle, p.brand_id, p.form, p.dietary_tags,
      p.rating_avg, p.rating_count, p.is_featured, p.published_at,
      b.name as brand_name, b.slug as brand_slug,
      v.id as variant_id, v.sku, v.price_cents, v.compare_at_price_cents,
      (select pi.storage_path from product_images pi
        where pi.product_id = p.id order by pi.position limit 1) as image_path,
      (
        coalesce((
          select sum(il.on_hand) from inventory_levels il where il.variant_id = v.id
        ), 0) > 0
        /*
         * …or a merchant is holding it. The same predicate as the buy box (docs/16 §1): an approved
         * offer with stock, from an approved merchant. A suspended merchant's stock leaves the listing
         * at the same moment it leaves the buy box, with nobody touching the offers.
         *
         * An `exists` rather than a call to `variant_buy_box`: this needs one boolean per row inside a
         * query already scanning the catalogue, and the predicate matches the partial index
         * `merchant_offers_live`, which was built for this shape.
         */
        or exists (
          select 1
            from merchant_offers mo
            join merchants m on m.id = mo.merchant_id
           where mo.variant_id = v.id
             and mo.status = 'approved'
             and mo.stock_on_hand > 0
             and m.status = 'approved'
        )
      ) as in_stock,
      case
        when n.q is null then 0
        else ts_rank(p.search_text, plainto_tsquery('simple', extensions.unaccent(n.q)))
           + extensions.similarity(coalesce(p.name->>'sq', ''), n.q)
      end as relevance
    from products p
    cross join normalized n
    join brands b on b.id = p.brand_id
    -- The default variant is what the card prices and adds to cart (docs/05 §2).
    join product_variants v
      on v.product_id = p.id and v.is_active and v.is_default
    where p.status = 'published'
      and p.deleted_at is null
      and b.is_active
      and (
        n.q is null
        or p.search_text @@ plainto_tsquery('simple', extensions.unaccent(n.q))
        -- Trigram fallback gives typo tolerance when FTS finds nothing.
        or extensions.similarity(coalesce(p.name->>'sq', ''), n.q) > 0.2
        or extensions.similarity(coalesce(p.name->>'en', ''), n.q) > 0.2
        or extensions.similarity(b.name, n.q) > 0.3
      )
      and (p_category_slugs is null or exists (
            select 1 from product_categories pc join categories c on c.id = pc.category_id
             where pc.product_id = p.id and c.slug = any(p_category_slugs)))
      and (p_brand_slugs is null or b.slug = any(p_brand_slugs))
      and (p_goal_slugs is null or exists (
            select 1 from product_health_goals pg join health_goals g on g.id = pg.goal_id
             where pg.product_id = p.id and g.slug = any(p_goal_slugs)))
      and (p_ingredient_slugs is null or exists (
            select 1 from product_ingredients pin join ingredients i on i.id = pin.ingredient_id
             where pin.product_id = p.id and i.slug = any(p_ingredient_slugs)))
      and (p_dietary_tags is null or p.dietary_tags @> p_dietary_tags)
      and (p_forms is null or p.form = any(p_forms))
      and (p_min_price_cents is null or v.price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or v.price_cents <= p_max_price_cents)
      and (p_min_rating is null or p.rating_avg >= p_min_rating)
      and (not p_on_sale_only or v.compare_at_price_cents is not null)
  ),
  filtered as (
    select * from base
     where not p_in_stock_only or in_stock
  )
  select
    f.id, f.slug, f.name, f.subtitle, f.brand_id, f.brand_name, f.brand_slug,
    f.form, f.dietary_tags, f.rating_avg, f.rating_count, f.is_featured, f.published_at,
    f.variant_id, f.sku, f.price_cents, f.compare_at_price_cents, f.image_path, f.in_stock,
    count(*) over () as total_count
  from filtered f
  order by
    -- Out-of-stock products stay visible but sink (docs/07 §11).
    f.in_stock desc,
    case when p_sort = 'price_asc'  then f.price_cents end asc nulls last,
    case when p_sort = 'price_desc' then f.price_cents end desc nulls last,
    case when p_sort = 'rating'     then f.rating_avg  end desc nulls last,
    case when p_sort = 'newest'     then f.published_at end desc nulls last,
    case when p_sort = 'relevance'  then f.relevance   end desc nulls last,
    f.is_featured desc,
    f.published_at desc nulls last,
    f.id
  limit greatest(1, least(coalesce(p_limit, 24), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;
