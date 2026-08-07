-- =============================================================================
-- 65 · Search foundation — the document, the vocabulary, the synonyms
-- Source: the search audit. Items 2, 3, 5 and 8.
-- =============================================================================

/*
 * ── What was wrong ──
 *
 * `products.search_text` held **name + subtitle + dietary_tags + brand**, and nothing else. In a
 * supplements shop the ingredient *is* the query — "magnez", "ashwagandha", "omega 3", "koenzima Q10" —
 * and none of those words were in the index unless they happened to appear in a marketing name. So the
 * shop had a hard recall ceiling that no amount of ranking work could lift: you cannot rank a document
 * that does not contain the word.
 *
 * `product_ingredients`, `product_health_goals` and `product_categories` were all fully modelled and
 * reachable as *facets*. They were simply never text.
 *
 * ── The four things this file changes ──
 *
 *   1. **The document widens** to ingredients (including `other_names`), health goals, categories, SKUs,
 *      form and slug — everything a shopper might name a product by.
 *   2. **`immutable_unaccent`** exists, so accent folding can go in an index expression. The trigram
 *      fallback compared *raw* text while the FTS path compared *unaccented* text, which meant the two
 *      halves of the matcher disagreed about ë and ç — on a market whose phone keyboards mostly omit them.
 *   3. **Synonyms**, as a table rather than a dictionary file. Postgres's `synonym` template reads from
 *      `$SHAREDIR/tsearch_data/`, which is not writable on hosted Supabase, so expansion happens at
 *      **index** time instead: if a document mentions any term in a group, every term in the group is
 *      appended to it. One lookup per product write, zero cost per query, and "vitamina C", "vitamin c"
 *      and "acid askorbik" all land on the same rows.
 *   4. **A vocabulary table**, which is what "did you mean" spell-corrects against.
 *
 * ── Why the document is rebuilt from a whole-row parameter ──
 *
 * `product_search_document(p_row public.products)` takes the row rather than an id. A `before` trigger on
 * `update` sees the new values in `new` but the *old* ones in the table, so an id-based builder would
 * index the previous name on every edit. Passing `new` is the only version that is correct for insert and
 * update both.
 */

-- Force pg_trgm's module to load so its GUCs are registered before anything below sets one.
do $$ begin perform extensions.show_trgm('biocode'); end $$;

-- -----------------------------------------------------------------------------
-- Normalisation primitives
-- -----------------------------------------------------------------------------

/**
 * `unaccent()` is declared STABLE, not IMMUTABLE, because the one-argument form resolves its dictionary
 * through `search_path`. That makes it unusable in an index expression — which is why the trigram indexes
 * were built on raw text and the fallback stayed accent-sensitive.
 *
 * The two-argument form takes the dictionary explicitly, so the result genuinely depends on nothing but
 * the input, and the `::regdictionary` cast on a literal is folded to an OID at parse time. Asserting
 * IMMUTABLE here is the standard workaround and it is honest: the answer changes only if someone edits
 * the unaccent rules file, which would require rebuilding every text index anyway.
 */
create or replace function public.immutable_unaccent(p_text text)
returns text
language sql immutable strict parallel safe
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, p_text) $$;

/** Lower-cased, accent-folded, whitespace-collapsed. NULL for anything that normalises to nothing. */
create or replace function public.search_normalize(p_text text)
returns text
language sql immutable parallel safe
as $$
  select nullif(
    btrim(regexp_replace(lower(public.immutable_unaccent(coalesce(p_text, ''))), '\s+', ' ', 'g')),
    ''
  )
$$;

/** The normalised query reduced to alphanumeric tokens, in order, capped at eight. */
create or replace function public.search_tokens(p_query text)
returns text[]
language sql immutable parallel safe
as $$
  select coalesce(array_agg(t.token order by t.ord), '{}'::text[])
    from (
      select token, ord
        from unnest(string_to_array(
               btrim(regexp_replace(coalesce(public.search_normalize(p_query), ''), '[^a-z0-9]+', ' ', 'g')),
               ' ')
             ) with ordinality as u(token, ord)
       where u.token <> ''
       order by ord
       limit 8
    ) t
$$;

/**
 * All terms required. The precise tier — this is what "vitamin d3" should match first.
 *
 * `plainto_tsquery` ANDs, which is right for ranking tier 1 and wrong as the only matcher; the prefix and
 * `any` variants below, plus the relaxed mode in `search_products`, are what stop an AND from becoming a
 * dead end.
 */
create or replace function public.search_plain_query(p_query text)
returns tsquery
language sql immutable parallel safe
as $$
  select nullif(plainto_tsquery('simple', coalesce(public.search_normalize(p_query), '')), ''::tsquery)
$$;

/**
 * All terms required, each matched as a prefix — "magne" finds magnesium.
 *
 * Tokens of one character stay exact. `c:*` would match every lexeme beginning with c and scan most of
 * the index for no recall worth having, whereas "vitamina c" wants the `c` to mean *c*.
 */
create or replace function public.search_prefix_query(p_query text)
returns tsquery
language sql immutable parallel safe
as $$
  select to_tsquery(
    'simple',
    nullif(
      (select string_agg(case when length(t.token) >= 2 then t.token || ':*' else t.token end, ' & '
                         order by t.ord)
         from unnest(public.search_tokens(p_query)) with ordinality as t(token, ord)),
      ''
    )
  )
$$;

/** Any term, as a prefix. The relaxed tier: recall over precision, used only when strict returns nothing. */
create or replace function public.search_any_query(p_query text)
returns tsquery
language sql immutable parallel safe
as $$
  select to_tsquery(
    'simple',
    nullif(
      (select string_agg(case when length(t.token) >= 2 then t.token || ':*' else t.token end, ' | '
                         order by t.ord)
         from unnest(public.search_tokens(p_query)) with ordinality as t(token, ord)),
      ''
    )
  )
$$;

/**
 * A set of terms as one OR'd tsquery, each multi-word term kept as a phrase.
 *
 * Used for the synonym groups: `{'omega 3','vaj peshku','fish oil'}` becomes
 * `(omega <-> 3) | (vaj <-> peshku) | (fish <-> oil)`, so "omega" alone does not drag in the group and
 * "3" certainly does not.
 */
create or replace function public.search_terms_query(p_terms text[])
returns tsquery
language sql immutable parallel safe
as $$
  select to_tsquery(
    'simple',
    nullif(
      -- Ordered by the term's position in the array. A STORED generated column must produce the same
      -- string every time it is recomputed, and an unordered `string_agg` does not promise that.
      (select string_agg('(' || replace(c.clean, ' ', ' <-> ') || ')', ' | ' order by c.ord)
         from (
           select btrim(regexp_replace(
                    coalesce(public.search_normalize(term), ''), '[^a-z0-9]+', ' ', 'g')) as clean,
                  ord
             from unnest(coalesce(p_terms, '{}'::text[])) with ordinality as u(term, ord)
         ) c
        where c.clean <> ''),
      ''
    )
  )
$$;

-- -----------------------------------------------------------------------------
-- Synonym groups
-- -----------------------------------------------------------------------------

/**
 * One row per *concept*, not per direction. `{'magnez','magnesium','mg','magnezium'}` is a single group
 * and every term in it reaches every other — a term→term table would need twelve rows for the same thing
 * and would rot the first time someone added a fifth spelling to only half of them.
 *
 * `match_query` is generated, so it can never drift from `terms`.
 */
create table search_synonym_groups (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  terms text[] not null,
  match_query tsquery generated always as (public.search_terms_query(terms)) stored,
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint search_synonym_groups_terms_size check (cardinality(terms) between 2 and 40)
);

create index search_synonym_groups_active_idx on search_synonym_groups (is_active, label);

alter table search_synonym_groups enable row level security;

/*
 * No public read policy, and that is deliberate. Nothing on the storefront queries this table — the
 * expansion has already happened by the time a shopper searches, baked into `products.search_text` — so
 * the only readers are staff and the security-definer builder below.
 */
create policy p_read on search_synonym_groups for select
  using ((select has_any_role('{product_manager,content_manager}')));
create policy p_write on search_synonym_groups for all
  using ((select has_any_role('{product_manager,content_manager}')))
  with check ((select has_any_role('{product_manager,content_manager}')));

create trigger set_updated_at before update on search_synonym_groups
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Vocabulary — what "did you mean" corrects against
-- -----------------------------------------------------------------------------

/**
 * Every lexeme in the published catalogue, with the number of products carrying it.
 *
 * Derived rather than authored: `ts_stat` over `products.search_text` means the vocabulary widens the
 * moment the catalogue does, including through the synonym groups. `doc_count` breaks ties towards the
 * word more products use, which is almost always the one the shopper meant.
 */
create table search_vocabulary (
  term text primary key,
  doc_count int not null default 0,
  updated_at timestamptz not null default now()
);

create index search_vocabulary_trgm on search_vocabulary using gin (term extensions.gin_trgm_ops);

alter table search_vocabulary enable row level security;

-- Read-only to the world: it is a list of words already visible on the shop grid, and the
-- did-you-mean RPC is security definer anyway.
create policy p_read on search_vocabulary for select using (true);
create policy p_write on search_vocabulary for all
  using ((select has_any_role('{product_manager}')))
  with check ((select has_any_role('{product_manager}')));

-- -----------------------------------------------------------------------------
-- The document
-- -----------------------------------------------------------------------------

/**
 * Everything a shopper might name this product by, normalised, with synonym groups appended.
 *
 * Description and how-to-use are **excluded on purpose**. They are paragraphs of prose; folding them in
 * would make every product match "take one capsule daily with food" and turn a precise catalogue of 91
 * items into a soup. Names, taxonomy and ingredients are what people search; long copy is what they read
 * once they arrive.
 */
create or replace function public.product_search_document(p_row public.products)
returns text
language sql stable security definer set search_path = public, extensions
as $$
  with raw as (
    select concat_ws(' ',
      p_row.name->>'sq', p_row.name->>'en',
      p_row.subtitle->>'sq', p_row.subtitle->>'en',
      p_row.slug,
      p_row.form::text,
      array_to_string(p_row.dietary_tags, ' '),
      (select concat_ws(' ', b.name, b.slug) from brands b where b.id = p_row.brand_id),
      (select string_agg(concat_ws(' ', c.name->>'sq', c.name->>'en', c.slug), ' ')
         from product_categories pc
         join categories c on c.id = pc.category_id
        where pc.product_id = p_row.id),
      (select string_agg(concat_ws(' ', g.name->>'sq', g.name->>'en', g.slug), ' ')
         from product_health_goals phg
         join health_goals g on g.id = phg.goal_id
        where phg.product_id = p_row.id),
      -- `other_names` is where "acid askorbik" and "cholecalciferol" already live (docs/03).
      (select string_agg(
                concat_ws(' ', i.name->>'sq', i.name->>'en', i.slug,
                          array_to_string(i.other_names, ' ')), ' ')
         from product_ingredients pin
         join ingredients i on i.id = pin.ingredient_id
        where pin.product_id = p_row.id),
      -- Staff and repeat buyers search by SKU; it costs one lexeme per variant.
      (select string_agg(v.sku, ' ')
         from product_variants v
        where v.product_id = p_row.id and v.is_active)
    ) as doc
  ),
  normalized as (
    select coalesce(public.search_normalize(doc), '') as doc from raw
  )
  select btrim(
    n.doc || ' ' ||
    coalesce((
      select string_agg(array_to_string(sg.terms, ' '), ' ')
        from search_synonym_groups sg
       where sg.is_active
         and sg.match_query is not null
         and to_tsvector('simple', n.doc) @@ sg.match_query
    ), '')
  )
  from normalized n
$$;

-- -----------------------------------------------------------------------------
-- Keeping it fresh
-- -----------------------------------------------------------------------------

create or replace function public.products_set_search() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  new.search_text := to_tsvector('simple', coalesce(public.product_search_document(new), ''));
  return new;
end $$;

drop trigger if exists products_search on products;
create trigger products_search
  before insert or update of name, subtitle, slug, form, dietary_tags, brand_id on products
  for each row execute function public.products_set_search();

/**
 * Re-index one product, by id.
 *
 * The update touches `search_text` only, and the trigger above is scoped `update of name, subtitle,
 * slug, form, dietary_tags, brand_id` — so this cannot re-enter itself. That column list is load-bearing;
 * widening it to a bare `update` would make every call below infinitely recursive.
 */
create or replace function public.refresh_product_search(p_product_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_doc text;
begin
  if p_product_id is null then return; end if;

  select public.product_search_document(p) into v_doc from products p where p.id = p_product_id;
  if not found then return; end if;

  update products set search_text = to_tsvector('simple', coalesce(v_doc, ''))
   where id = p_product_id;
end $$;

/**
 * Row trigger for the join tables — they all carry `product_id`.
 *
 * Branched on `tg_op` rather than `coalesce`-ing the two records: in a DELETE trigger `new` is unassigned
 * and touching it raises, so the guard has to be control flow rather than an expression that merely
 * *looks* short-circuited.
 */
create or replace function public.refresh_product_search_row() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if tg_op = 'DELETE' then
    v_id := (to_jsonb(old)->>'product_id')::uuid;
  else
    v_id := (to_jsonb(new)->>'product_id')::uuid;
  end if;

  perform public.refresh_product_search(v_id);

  -- An UPDATE that moves a row between products has to re-index both sides.
  if tg_op = 'UPDATE' then
    if (to_jsonb(old)->>'product_id')::uuid is distinct from v_id then
      perform public.refresh_product_search((to_jsonb(old)->>'product_id')::uuid);
    end if;
  end if;

  return null;
end $$;

create trigger refresh_search after insert or delete on product_categories
  for each row execute function public.refresh_product_search_row();
create trigger refresh_search after insert or delete on product_health_goals
  for each row execute function public.refresh_product_search_row();
create trigger refresh_search after insert or delete on product_ingredients
  for each row execute function public.refresh_product_search_row();
create trigger refresh_search after insert or delete or update of sku, is_active on product_variants
  for each row execute function public.refresh_product_search_row();

/** Whole-catalogue re-index. Cheap at this size, and the only correct answer after a synonym edit. */
create or replace function public.reindex_products_search() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_count int;
begin
  update products p
     set search_text = to_tsvector('simple', coalesce(d.doc, ''))
    from (select p2.id, public.product_search_document(p2) as doc from products p2) d
   where p.id = d.id;

  get diagnostics v_count = row_count;
  perform public.refresh_search_vocabulary();
  return v_count;
end $$;

/**
 * A renamed brand, ingredient, goal or category changes the document of every product that references it.
 *
 * The old trigger read the brand name at product-write time and never looked again, so renaming a brand
 * left every one of its products indexed under the previous name until someone happened to re-save them.
 */
create or replace function public.refresh_search_for_referrers() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := new.id;
begin
  if tg_table_name = 'brands' then
    perform public.refresh_product_search(p.id) from products p where p.brand_id = v_id;
  elsif tg_table_name = 'ingredients' then
    perform public.refresh_product_search(pin.product_id)
       from product_ingredients pin where pin.ingredient_id = v_id;
  elsif tg_table_name = 'health_goals' then
    perform public.refresh_product_search(phg.product_id)
       from product_health_goals phg where phg.goal_id = v_id;
  elsif tg_table_name = 'categories' then
    perform public.refresh_product_search(pc.product_id)
       from product_categories pc where pc.category_id = v_id;
  end if;
  return null;
end $$;

create trigger refresh_search after update of name, slug on brands
  for each row when (old.name is distinct from new.name or old.slug is distinct from new.slug)
  execute function public.refresh_search_for_referrers();
create trigger refresh_search after update of name, slug, other_names on ingredients
  for each row when (old.name is distinct from new.name
                     or old.slug is distinct from new.slug
                     or old.other_names is distinct from new.other_names)
  execute function public.refresh_search_for_referrers();
create trigger refresh_search after update of name, slug on health_goals
  for each row when (old.name is distinct from new.name or old.slug is distinct from new.slug)
  execute function public.refresh_search_for_referrers();
create trigger refresh_search after update of name, slug on categories
  for each row when (old.name is distinct from new.name or old.slug is distinct from new.slug)
  execute function public.refresh_search_for_referrers();

/**
 * Vocabulary rebuild.
 *
 * `ts_stat` reads the published corpus only — an unpublished draft's words would be suggested to a
 * shopper who could never find them, which is worse than no suggestion. Three characters minimum:
 * "mg" and "d3" are real, but two-letter noise dominates the trigram ranking and turns every typo into
 * a suggestion of "iu".
 */
create or replace function public.refresh_search_vocabulary() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_count int;
begin
  delete from search_vocabulary;
  insert into search_vocabulary (term, doc_count)
  select word, ndoc
    from ts_stat($q$select search_text from public.products
                     where status = 'published' and deleted_at is null$q$)
   where length(word) >= 3
  on conflict (term) do update set doc_count = excluded.doc_count, updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end $$;

/** A synonym edit changes every document. Statement-level, so a bulk insert re-indexes once. */
create or replace function public.reindex_after_synonym_change() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.reindex_products_search();
  return null;
end $$;

create trigger reindex_products after insert or update or delete on search_synonym_groups
  for each statement execute function public.reindex_after_synonym_change();

-- -----------------------------------------------------------------------------
-- Indexes (item 8 — the two matcher halves now fold accents identically)
-- -----------------------------------------------------------------------------

drop index if exists products_name_trgm;
drop index if exists products_name_en_trgm;
drop index if exists brands_name_trgm;

/*
 * Indexed on exactly the expression the RPC compares against — `search_normalize(...)`, not raw text and
 * not `lower(...)`. If the two ever diverge the index is silently unused and the only symptom is a
 * sequential scan that nobody notices until the catalogue is large enough to hurt.
 */
create index products_name_sq_trgm on products
  using gin (public.search_normalize(name->>'sq') extensions.gin_trgm_ops);
create index products_name_en_trgm on products
  using gin (public.search_normalize(name->>'en') extensions.gin_trgm_ops);
create index brands_name_trgm on brands
  using gin (public.search_normalize(name) extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- Backfill
-- -----------------------------------------------------------------------------

select public.reindex_products_search();

grant execute on function public.search_normalize(text)      to anon, authenticated;
grant execute on function public.search_plain_query(text)    to anon, authenticated;
grant execute on function public.search_prefix_query(text)   to anon, authenticated;
grant execute on function public.search_any_query(text)      to anon, authenticated;
