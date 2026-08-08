-- =============================================================================
-- 75 · Search suggest learns Knowledge, and products gain a descriptor
-- Source: the persistent-header-search brief, Part 3.
-- =============================================================================

/*
 * ── The Knowledge group finally has somewhere to point ──
 *
 * `search/actions.ts` has carried this note since M4: articles were left out of the overlay because
 * `/knowledge/[slug]` did not exist yet, and "a surface with no destination" is worse than a missing
 * group. That route shipped with M8. The comment outlived the constraint, which is the ordinary way a
 * deliberate omission turns into an accidental gap.
 *
 * Matched on title *and* excerpt. An article is found by what it is about rather than by what it was
 * named, and a good headline is often the one that says least.
 *
 * ── Products gain `form` and `subtitle` ──
 *
 * The brief asks each product row to show a short form/dose descriptor beside the price. Both were
 * already on the row `search_products` returns; the suggest payload simply was not passing them
 * through.
 *
 * Restated in full from migration 70 by script rather than retyped — `create or replace` on an
 * accumulated function is the sum of every migration that touched it (docs/13 §X3), and this body
 * already carries the strict-word-similarity fix.
 */

do $trgm$ begin perform extensions.show_trgm('biocode'); end $trgm$;

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
               'form', s.form,
               'subtitle', s.subtitle,
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

    'articles', coalesce((
      select jsonb_agg(jsonb_build_object('slug', a2.slug, 'title', a2.title) order by a2.published_at desc)
        from (
          select a.slug, a.title, a.published_at
            from articles a, q
           where a.status = 'published'
             and a.deleted_at is null
             and q.norm is not null
             and (public.search_normalize(a.title->>'sq') operator(extensions.%>>) q.norm
                  or public.search_normalize(a.title->>'en') operator(extensions.%>>) q.norm
                  or public.search_normalize(a.excerpt->>'sq') operator(extensions.%>>) q.norm
                  or public.search_normalize(a.excerpt->>'en') operator(extensions.%>>) q.norm
                  or starts_with(a.slug, q.norm))
           order by a.published_at desc nulls last
           limit 3
        ) a2
    ), '[]'::jsonb),

    'didYouMean', to_jsonb(public.search_did_you_mean(p_query))
  )
  from q
$$;
