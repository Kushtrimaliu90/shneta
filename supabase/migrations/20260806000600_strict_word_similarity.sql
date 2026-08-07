-- =============================================================================
-- 70 · Strict word similarity — stop the matcher borrowing trigrams across words
-- Source: measured against the live catalogue after migration 68.
-- =============================================================================

/*
 * ── The bug, and how it was found ──
 *
 * Migration 68 replaced whole-string `similarity` with `word_similarity`, which was the right move: it
 * measures the best matching *word extent* inside a long product name instead of comparing the whole
 * string, so "k2" can find "Vitamin D3 4000 IU + K2 MK-7 Softgels".
 *
 * Then searching **"magnesium"** on the live catalogue returned, in order:
 *
 *     1. Solgar Kalcium Magnez plus D3
 *     2. NOW Magnez Citrat 200 mg
 *     3. Solgar Magnez Bisglicinat
 *
 * A calcium-and-magnesium blend above two products that are only magnesium. The scores said why:
 *
 *     word_similarity('magnesium', 'solgar kalcium magnez plus d3') = 0.700
 *     word_similarity('magnesium', 'solgar magnez bisglicinat')     = 0.500
 *
 * `word_similarity` lets the matching extent start and end **anywhere**, including mid-word. "magnesium"
 * wants the trigrams `mag agn gne nes esi siu ium`; "magnez" supplies the first four, and the extent is
 * free to reach back into **kalciUM** for the `ium`. The blend scored higher than the pure product
 * because of a coincidence in the tail of an unrelated word.
 *
 * `strict_word_similarity` requires the extent to align to word boundaries, which removes the borrowing:
 *
 *     strict_word_similarity('magnesium', 'solgar kalcium magnez plus d3') = 0.417
 *     strict_word_similarity('magnesium', 'solgar magnez bisglicinat')     = 0.417
 *
 * — a tie, which is the honest answer. Neither name contains "magnesium"; both reach it through the same
 * synonym group. Genuine matches are untouched: "vitamina c" against "Solgar Vitamina C 1000 mg" stays
 * 1.000, and noise falls further ("Garden of Life Collagen Beauty" 0.091 → 0.053).
 *
 * ── What was tried and rejected ──
 *
 * Adding whole-string `similarity` as a "focus" tiebreak — the idea being that a short, single-subject
 * name is more about the query than a long list — **made it worse**, and for the same underlying reason:
 *
 *     similarity('magnesium', 'solgar kalcium magnez plus d3') = 0.212
 *     similarity('magnesium', 'solgar magnez bisglicinat')     = 0.161
 *
 * The blend wins there too, because `similarity` reads `kalcium` exactly as `word_similarity` did. Two
 * measurements of the same contamination do not cancel out. Rejected, and recorded here so it is not
 * proposed again.
 *
 * ── What breaks the tie instead ──
 *
 * Nothing in this file. Telling "pure magnesium" from "calcium plus magnesium plus D3" needs to know
 * which ingredient is *primary*, and the schema does not model that. So the tie falls through to rating,
 * featured, and then to the two mechanisms built for exactly this: an operator pinning the right product
 * for "magnesium" (migration 66), informed by the query report noticing that the query converts badly
 * (migration 67). Guessing a weight here, against zero traffic, is the unfalsifiable tuning that the
 * logging exists to replace.
 *
 * ── Mechanical note ──
 *
 * The three bodies below are migration 68's, transformed by script — `word_similarity` →
 * `strict_word_similarity`, `%>` → `%>>`, and the threshold GUC renamed to its strict counterpart at
 * 0.35 (real matches measured at 0.417 and above; noise at 0.053). Not retyped: docs/13 §X3 is the
 * migration that was retyped from memory and silently reverted a fix five files old.
 *
 * `%>>` is the commutator of `<<%` and is supported by `gin_trgm_ops`, so the expression indexes from
 * migration 65 still apply.
 *
 * `search_did_you_mean` is deliberately unchanged. It compares one query token against one vocabulary
 * term — both single words — so there is no neighbouring word to borrow from.
 */

/*
 * pg_trgm GUCs are registered when its shared library loads, not when the extension is created. A
 * function-level `SET pg_trgm.…` therefore fails with "unrecognized configuration parameter" in any
 * session that has not yet touched the module.
 *
 * Migration 68 set `pg_trgm.word_similarity_threshold` and applied cleanly only because it shared a
 * push — and therefore a session — with migration 65, which force-loads pg_trgm. Pushed on its own it
 * would have failed the same way this file did on its first attempt. One cheap call, and the GUC below
 * is recognised no matter how this migration is applied.
 */
do $trgm$ begin perform extensions.show_trgm('biocode'); end $trgm$;

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
  p_offset int default 0,
  p_locale text default 'sq',
  p_match_mode text default 'strict'
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
language sql stable security definer
set search_path = public, extensions
/*
 * `%>` reads its cut-off from this GUC, and the default of 0.6 is too strict for a shop: it drops
 * "magnezium" against "Magnesium". Set on the function so it applies to this body and nothing else —
 * a `set_config` inside would leak into the caller's session.
 */
set pg_trgm.strict_word_similarity_threshold = '0.35'
as $$
  -- NOT MATERIALIZED so the planner sees these expressions inline. Materialised, the trigram predicates
  -- below become join quals against a CTE and the GIN indexes go unused — invisible at 91 products, a
  -- cliff at marketplace scale.
  with q as not materialized (
    select
      public.search_normalize(p_query)                       as norm,
      public.search_plain_query(p_query)                     as plain_q,
      public.search_prefix_query(p_query)                    as prefix_q,
      public.search_any_query(p_query)                       as any_q,
      coalesce(p_match_mode, 'strict') = 'relaxed'           as relaxed,
      case when p_locale = 'en' then 'en' else 'sq' end      as loc
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
      case when rule.action = 'pin' then rule.pin_position end as pin_position,
      (
        case
          when q.norm is null then 0::numeric
          else (
            /* 1 · exact. The query *is* this product. */
            (case
               when public.search_normalize(p.name->>'sq') = q.norm
                 or public.search_normalize(p.name->>'en') = q.norm
                 or p.slug = q.norm
                 or lower(v.sku) = q.norm
               then 8.0 else 0.0
             end)
            /* 2 · every term present. */
          + (case when p.search_text @@ q.plain_q then 3.0 else 0.0 end)
            /* 3 · every term present as a prefix. */
          + (case when p.search_text @@ q.prefix_q then 1.5 else 0.0 end)
            /* 4 · the typo net, weighted towards the locale being read. */
          + 2.5 * coalesce(extensions.strict_word_similarity(
                    q.norm, public.search_normalize(p.name->>q.loc)), 0)
          + 1.2 * coalesce(extensions.strict_word_similarity(
                    q.norm, public.search_normalize(p.name->>(case when q.loc = 'sq' then 'en' else 'sq' end))), 0)
          + 1.0 * coalesce(extensions.strict_word_similarity(q.norm, public.search_normalize(b.name)), 0)
            /* Normalisation flag 32 is rank/(rank+1), which bounds ts_rank to 0–1 so it can be
               weighted against the others rather than drowned by them. */
          + 0.8 * coalesce(ts_rank(p.search_text, coalesce(q.plain_q, q.prefix_q, q.any_q), 32), 0)
          )
        end
        * (
          /* Quality, bounded at +20%. A tiebreak between comparable matches, never an override. */
          1.0
          + 0.12 * (case when p.rating_count > 0 then least(p.rating_avg, 5) / 5.0 else 0 end)
          + 0.08 * (case when p.is_featured then 1 else 0 end)
        )
        /* Merchandising, absolute — "+2" means the same thing on every product. */
        + coalesce(case when rule.action in ('boost', 'bury') then rule.weight else 0 end, 0)
      ) as relevance
    from products p
    cross join q
    join brands b on b.id = p.brand_id
    -- The default variant is what the card prices and adds to cart (docs/05 §2).
    join product_variants v
      on v.product_id = p.id and v.is_active and v.is_default
    /*
     * The most specific applicable rule, and only one. Exact beats contains beats any, and a longer
     * `contains` beats a shorter one — so "vitamin c gummies" can have its own rule without the broader
     * "vitamin" rule fighting it.
     */
    left join lateral (
      select r.action, r.pin_position, r.weight
        from search_rules r
       where r.is_active
         and r.product_id = p.id
         and (
           r.match_type = 'any'
           or (r.match_type = 'exact' and r.query = q.norm)
           -- `position`, not `like '%'||r.query||'%'`: a rule saved with a `%` or `_` in it would
           -- otherwise be a wildcard, and "50% off" would match every query on the shop.
           or (r.match_type = 'contains' and position(r.query in q.norm) > 0)
         )
       order by case r.match_type when 'exact' then 0 when 'contains' then 1 else 2 end,
                length(coalesce(r.query, '')) desc
       limit 1
    ) rule on true
    where p.status = 'published'
      and p.deleted_at is null
      and b.is_active
      -- `hide` removes a product from results without unpublishing it.
      and (rule.action is null or rule.action <> 'hide')
      and (
        q.norm is null
        or (
          not q.relaxed and (
               p.search_text @@ q.plain_q
            or p.search_text @@ q.prefix_q
            /*
             * Indexed-column-on-the-left form of `q <% name`. Written as `%>` rather than relying on the
             * planner's commutator so the GIN expression indexes from migration 65 are matched directly,
             * and `operator(extensions.…)` rather than bare `%>` so a search_path surprise inside a
             * security-definer body cannot silently change which operator this is.
             */
            or public.search_normalize(p.name->>'sq') operator(extensions.%>>) q.norm
            or public.search_normalize(p.name->>'en') operator(extensions.%>>) q.norm
            or public.search_normalize(b.name)        operator(extensions.%>>) q.norm
          )
        )
        or (
          q.relaxed and (
               p.search_text @@ q.any_q
            or public.search_normalize(p.name->>'sq') operator(extensions.%>>) q.norm
            or public.search_normalize(p.name->>'en') operator(extensions.%>>) q.norm
            or public.search_normalize(b.name)        operator(extensions.%>>) q.norm
          )
        )
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
    /*
     * Pins order *within* the in-stock group, and only under relevance.
     *
     * Below `in_stock` on purpose: a pin on something unbuyable is almost always an operator forgetting
     * to clear a rule, and honouring it would put an out-of-stock product at position one. Ignored
     * entirely under an explicit sort — a shopper who asked for cheapest-first has overruled the
     * merchandiser, and quietly re-inserting a pin at the top would be a lie about the sort.
     */
    case when p_sort = 'relevance' then f.pin_position end asc nulls last,
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

create or replace function public.search_suggest(
  p_query text,
  p_locale text default 'sq',
  p_limit int default 5
) returns jsonb
language sql stable security definer
set search_path = public, extensions
set pg_trgm.strict_word_similarity_threshold = '0.35'
as $$
  with q as not materialized (
    select
      public.search_normalize(p_query) as norm,
      case when p_locale = 'en' then 'en' else 'sq' end as loc,
      -- Completions apply to the word still being typed, which is the last one.
      (public.search_tokens(p_query))[array_length(public.search_tokens(p_query), 1)] as tail
  ),
  /*
   * One call, used for both the rows and the count.
   *
   * `total_count` is a window function computed before the limit, so it is the *full* result count even
   * though only a handful of rows come back — no second call needed, and calling twice would double the
   * cost of the hottest query in the system for a number already in the first answer.
   *
   * `with ordinality` rather than `row_number() over ()`: the RPC's own `order by` is the ranking, and
   * ordinality captures it as data instead of trusting `jsonb_agg` to preserve arrival order.
   */
  prods as (
    select *
      from public.search_products(
             p_query => p_query,
             p_sort => 'relevance',
             p_limit => greatest(1, least(coalesce(p_limit, 5), 10)),
             p_locale => p_locale
           ) with ordinality
  )
  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.product_id,
               'slug', s.slug,
               'name', s.name,
               'brandName', s.brand_name,
               'imagePath', s.image_path,
               'priceCents', s.price_cents,
               'inStock', s.in_stock
             ) order by s.ordinality)
        from prods s
    ), '[]'::jsonb),

    'total', coalesce((select max(s.total_count) from prods s), 0),

    -- Query completions, commonest first. `doc_count` is how many products carry the word, which is a
    -- decent stand-in for "what the shopper probably meant" until there is click data to beat it.
    'terms', coalesce((
      select jsonb_agg(t.term order by t.doc_count desc, t.term)
        from (
          select v.term, v.doc_count
            from search_vocabulary v, q
           where q.tail is not null
             and length(q.tail) >= 2
             -- `starts_with`, not `like q.tail || '%'`. The tail comes from the shopper, and a typed
             -- `%` or `_` in a LIKE pattern is a wildcard that matches the whole vocabulary.
             and starts_with(v.term, q.tail)
             and v.term <> q.tail
           order by v.doc_count desc, v.term
           limit 5
        ) t
    ), '[]'::jsonb),

    'brands', coalesce((
      select jsonb_agg(jsonb_build_object('slug', b2.slug, 'name', b2.name) order by b2.name)
        from (
          select b.slug, b.name
            from brands b, q
           where b.is_active
             and q.norm is not null
             and (public.search_normalize(b.name) operator(extensions.%>>) q.norm
                  or starts_with(public.search_normalize(b.name), q.norm))
           order by b.name
           limit 3
        ) b2
    ), '[]'::jsonb),

    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('slug', c2.slug, 'name', c2.name) order by c2.sort_order)
        from (
          select c.slug, c.name, c.sort_order
            from categories c, q
           where c.is_active
             and c.deleted_at is null
             and q.norm is not null
             and (public.search_normalize(c.name->>'sq') operator(extensions.%>>) q.norm
                  or public.search_normalize(c.name->>'en') operator(extensions.%>>) q.norm)
           order by c.sort_order
           limit 3
        ) c2
    ), '[]'::jsonb),

    'ingredients', coalesce((
      select jsonb_agg(jsonb_build_object('slug', i2.slug, 'name', i2.name) order by i2.slug)
        from (
          select i.slug, i.name
            from ingredients i, q
           where i.is_active
             and q.norm is not null
             /*
              * `other_names` is finally matched against, not merely selected. The old `ilike` read
              * `name` and `slug` only while its own comment claimed it covered the synonyms — so
              * "acid askorbik" never found ascorbic acid despite the alias sitting right there.
              */
             and (public.search_normalize(i.name->>'sq') operator(extensions.%>>) q.norm
                  or public.search_normalize(i.name->>'en') operator(extensions.%>>) q.norm
                  or starts_with(i.slug, q.norm)
                  or exists (
                       select 1 from unnest(i.other_names) as alias
                        where public.search_normalize(alias) operator(extensions.%>>) q.norm
                     ))
           order by i.slug
           limit 5
        ) i2
    ), '[]'::jsonb),

    'didYouMean', to_jsonb(public.search_did_you_mean(p_query))
  )
  from q
$$;

create or replace function public.search_ingredients(
  p_query text,
  p_limit int default 20
) returns table (slug text, name jsonb)
language sql stable security definer
set search_path = public, extensions
set pg_trgm.strict_word_similarity_threshold = '0.35'
as $$
  select i.slug, i.name
    from ingredients i
   cross join (select public.search_normalize(p_query) as norm) q
   where i.is_active
     and q.norm is not null
     and (
          public.search_normalize(i.name->>'sq') operator(extensions.%>>) q.norm
       or public.search_normalize(i.name->>'en') operator(extensions.%>>) q.norm
       or starts_with(i.slug, q.norm)
       or exists (
            select 1 from unnest(i.other_names) as alias
             where public.search_normalize(alias) operator(extensions.%>>) q.norm
          )
     )
   order by
     greatest(
       coalesce(extensions.strict_word_similarity(q.norm, public.search_normalize(i.name->>'sq')), 0),
       coalesce(extensions.strict_word_similarity(q.norm, public.search_normalize(i.name->>'en')), 0)
     ) desc,
     i.slug
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;
