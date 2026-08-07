-- =============================================================================
-- 68 · search_products, rebuilt — matching, ranking, relaxation, suggest
-- Source: the search audit, items 3, 4, 6 and 7.
-- =============================================================================

/*
 * ── What the old ranking actually sorted by ──
 *
 *     ts_rank(search_text, plainto_tsquery(...)) + similarity(name->>'sq', q)
 *
 * Two terms on incompatible scales. `ts_rank` returns roughly 0.06 for a real single-term hit; `similarity`
 * returns 0.3–0.6. So the second term outweighed the first by about an order of magnitude and the sort
 * order was, in practice, *how much does the Albanian name look like the query string* — with the actual
 * relevance score as rounding error. An `/en` shopper got the worst of it: `similarity` read `name->>'sq'`
 * only, so English queries were ranked by a ts_rank that was all noise, i.e. arbitrarily.
 *
 * `similarity()` was also the wrong function. It compares **whole strings**, and supplement names are long:
 *
 *     similarity('Magnesium Bisglycinate 400mg 120 Capsules', 'magnesium') ≈ 0.22
 *
 * — barely over the 0.2 threshold for a perfect, unambiguous, single-word match. Search "k2" against
 * "Vitamin D3 4000 IU + K2 MK-7 Softgels" and it is nowhere near. `word_similarity` measures the best
 * matching *word extent* inside the string instead, which is the right question for a short query against
 * a long title, and unlike `similarity(a,b) > c` it is index-backed.
 *
 * ── Four tiers, in order of how much they mean ──
 *
 *   1. **Exact** — the query *is* the name, the slug or a SKU. Nothing should outrank this.
 *   2. **All terms** (`plainto_tsquery`) — the precise hit.
 *   3. **All terms as prefixes** — "magne" finds magnesium.
 *   4. **Word similarity** on name and brand — the typo net.
 *
 * Business signal is a **multiplier bounded at ±20%**, never an additive term. Rating and featured break
 * ties between comparable matches; they must not let a well-reviewed irrelevance climb over the product
 * the shopper actually named. Merchandising weight is added *after* the multiplier, because a boost of
 * "+2" from an operator should mean the same thing regardless of the product's rating.
 *
 * ── Relaxation instead of an OR ──
 *
 * `plainto_tsquery` ANDs its terms, so "vitamin d3 1000" needs all three and multi-word queries collapse
 * to nothing fast. The tempting fix — OR the terms — is worse than the disease: "vitamin c" would then
 * match every product containing "vitamin", and `total_count` would tell the shopper there are 47 results
 * when three are relevant.
 *
 * So strict stays strict, and `p_match_mode => 'relaxed'` is a **second pass the caller makes only when
 * the first returned nothing**. The count stays honest, the cost is paid only on the zero-result path, and
 * the UI can say "no exact matches for X, showing related" — which is the truth, and more useful than
 * either a lie or an empty page.
 */

/*
 * pg_trgm's GUCs are registered when its shared library loads, not when the extension is created, so the
 * function-level `SET pg_trgm.…` below is only recognised in a session that has already touched the
 * module. This applied cleanly on the first push because migration 65 force-loads it and shared the
 * session; on a fresh `supabase db reset` that is luck rather than a guarantee. One cheap call removes
 * the dependency — and migration 70 failed exactly this way before it grew the same line.
 */
do $trgm$ begin perform extensions.show_trgm('biocode'); end $trgm$;

/*
 * Dropped rather than replaced. `create or replace` cannot add a parameter — it would create a second
 * overload, and PostgREST resolves by argument names, so both would be reachable and which one answered
 * would depend on exactly which keys the client sent. The old signature is spelled out in full so this
 * fails loudly if it ever drifts (docs/13 §X3).
 */
drop function if exists public.search_products(
  text, text[], text[], text[], text[], text[], product_form[],
  int, int, numeric, boolean, boolean, text, int, int
);

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
set pg_trgm.word_similarity_threshold = '0.45'
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
          + 2.5 * coalesce(extensions.word_similarity(
                    q.norm, public.search_normalize(p.name->>q.loc)), 0)
          + 1.2 * coalesce(extensions.word_similarity(
                    q.norm, public.search_normalize(p.name->>(case when q.loc = 'sq' then 'en' else 'sq' end))), 0)
          + 1.0 * coalesce(extensions.word_similarity(q.norm, public.search_normalize(b.name)), 0)
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
            or public.search_normalize(p.name->>'sq') operator(extensions.%>) q.norm
            or public.search_normalize(p.name->>'en') operator(extensions.%>) q.norm
            or public.search_normalize(b.name)        operator(extensions.%>) q.norm
          )
        )
        or (
          q.relaxed and (
               p.search_text @@ q.any_q
            or public.search_normalize(p.name->>'sq') operator(extensions.%>) q.norm
            or public.search_normalize(p.name->>'en') operator(extensions.%>) q.norm
            or public.search_normalize(b.name)        operator(extensions.%>) q.norm
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

-- -----------------------------------------------------------------------------
-- Did you mean
-- -----------------------------------------------------------------------------

-- Prefix completions want a btree the default collation can actually use for `LIKE 'x%'`.
create index search_vocabulary_prefix_idx on search_vocabulary (term text_pattern_ops);

/**
 * Per-token spelling correction against the catalogue's own vocabulary.
 *
 * Corrects **token by token** rather than whole-query, because the realistic typo is one wrong word in an
 * otherwise fine query — "magneziumi bisglicinat" should become "magnezium bisglicinat", not be abandoned
 * for whichever single word happens to look closest to the whole string.
 *
 * A token already in the vocabulary is left alone even if something scores higher: the shopper typed a
 * real word from the catalogue and second-guessing that is how "vitamin" becomes "vitamina" for an English
 * reader. Returns NULL when the correction is the query — there is nothing to suggest.
 */
create or replace function public.search_did_you_mean(p_query text)
returns text
language sql stable security definer
set search_path = public, extensions
-- Tighter than the 0.3 default: a suggestion that is only vaguely similar is worse than none, because the
-- shopper follows it and lands somewhere equally wrong.
set pg_trgm.similarity_threshold = '0.4'
as $$
  select nullif(
    (
      select string_agg(c.term, ' ' order by c.ord)
        from (
          select t.ord,
                 coalesce(
                   (select v.term from search_vocabulary v where v.term = t.token),
                   (select v.term
                      from search_vocabulary v
                     where v.term operator(extensions.%) t.token
                     order by extensions.similarity(v.term, t.token) desc, v.doc_count desc, v.term
                     limit 1),
                   t.token
                 ) as term
            from unnest(public.search_tokens(p_query)) with ordinality as t(token, ord)
        ) c
    ),
    -- Identical to what they typed means there is nothing worth saying.
    array_to_string(public.search_tokens(p_query), ' ')
  )
$$;

-- -----------------------------------------------------------------------------
-- Suggest
-- -----------------------------------------------------------------------------

/**
 * Everything the instant overlay needs, in one round trip.
 *
 * It replaces two calls (`search_products` plus an `ilike` over ingredients) with one, and adds the three
 * result kinds the overlay never had: **query completions**, **brands** and **categories**. A shopper
 * typing "sol" should be offered "Solgar" as a brand, not made to guess which of five Solgar products the
 * grid decided to show first.
 *
 * Products come from `search_products` rather than a bespoke query. A dedicated lighter query would save
 * the per-row inventory check, but it would also be free to rank differently from the results page — and
 * "I saw it in the dropdown and it wasn't on the page" is a worse bug than a few milliseconds. One ranking
 * function, one answer.
 */
create or replace function public.search_suggest(
  p_query text,
  p_locale text default 'sq',
  p_limit int default 5
) returns jsonb
language sql stable security definer
set search_path = public, extensions
set pg_trgm.word_similarity_threshold = '0.45'
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
             and (public.search_normalize(b.name) operator(extensions.%>) q.norm
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
             and (public.search_normalize(c.name->>'sq') operator(extensions.%>) q.norm
                  or public.search_normalize(c.name->>'en') operator(extensions.%>) q.norm)
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
             and (public.search_normalize(i.name->>'sq') operator(extensions.%>) q.norm
                  or public.search_normalize(i.name->>'en') operator(extensions.%>) q.norm
                  or starts_with(i.slug, q.norm)
                  or exists (
                       select 1 from unnest(i.other_names) as alias
                        where public.search_normalize(alias) operator(extensions.%>) q.norm
                     ))
           order by i.slug
           limit 5
        ) i2
    ), '[]'::jsonb),

    'didYouMean', to_jsonb(public.search_did_you_mean(p_query))
  )
  from q
$$;

-- -----------------------------------------------------------------------------
-- Ingredients
-- -----------------------------------------------------------------------------

/**
 * Ingredient matching for the results page, by name in either language, by slug, and by the aliases in
 * `other_names`.
 *
 * The `ilike` this replaces filtered on `name->>sq`, `name->>en` and `slug` — while selecting
 * `other_names` and carrying a comment claiming it searched the synonyms. It never did. So "acid
 * askorbik" did not find ascorbic acid, "vaj peshku" did not find omega-3 and "kolekalciferol" did not
 * find vitamin D3, with every one of those aliases sitting in the row that should have matched.
 *
 * Ordered by how well it matched rather than by slug: the old query returned alphabetical order, so
 * searching "magnez" put whatever ingredient starts with an early letter above magnesium.
 */
create or replace function public.search_ingredients(
  p_query text,
  p_limit int default 20
) returns table (slug text, name jsonb)
language sql stable security definer
set search_path = public, extensions
set pg_trgm.word_similarity_threshold = '0.45'
as $$
  select i.slug, i.name
    from ingredients i
   cross join (select public.search_normalize(p_query) as norm) q
   where i.is_active
     and q.norm is not null
     and (
          public.search_normalize(i.name->>'sq') operator(extensions.%>) q.norm
       or public.search_normalize(i.name->>'en') operator(extensions.%>) q.norm
       or starts_with(i.slug, q.norm)
       or exists (
            select 1 from unnest(i.other_names) as alias
             where public.search_normalize(alias) operator(extensions.%>) q.norm
          )
     )
   order by
     greatest(
       coalesce(extensions.word_similarity(q.norm, public.search_normalize(i.name->>'sq')), 0),
       coalesce(extensions.word_similarity(q.norm, public.search_normalize(i.name->>'en')), 0)
     ) desc,
     i.slug
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.search_did_you_mean(text) to anon, authenticated;
grant execute on function public.search_suggest(text, text, int) to anon, authenticated;
grant execute on function public.search_ingredients(text, int) to anon, authenticated;
