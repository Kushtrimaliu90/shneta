-- 83 · An admin-set category picture beats the derived one
--
-- Migration 82 gave each homepage category tile the best-rated photographed product in it, because
-- `categories.image_path` was null on every row and there was no way to set it. There is now: the brand
-- logo uploader was generalised to categories and health goals, so the column is reachable from
-- `/admin/categories`.
--
-- The owner's rule, stated plainly (2026-08-11): **admin wins**. A picture chosen deliberately is a
-- merchandising decision and outranks one the query inferred. The derived photograph stays as the
-- fallback rather than being dropped, so a category nobody has got to still looks like a shelf instead of
-- an empty panel — which is the whole reason it exists.
--
-- `coalesce` is the entire change. The ordering below still picks the best product photograph, and that
-- result is simply overridden when a human has said otherwise.
create or replace view public.v_category_tiles with (security_invoker = on) as
  select distinct on (c.id)
    c.id            as category_id,
    c.slug,
    c.name,
    c.sort_order,
    count(*) over (partition by c.id)::int as product_count,
    coalesce(c.image_path, pi.storage_path) as image_path,
    /*
     * The alt text has to follow the picture it describes. When the admin's image wins, the product's
     * alt text would be describing something not on screen — the category name is the honest fallback.
     */
    case when c.image_path is not null then c.name else coalesce(pi.alt, p.name) end as image_alt,
    (c.image_path is not null) as image_is_curated
  from categories c
  join product_categories pc on pc.category_id = c.id
  join products p on p.id = pc.product_id
  left join lateral (
    select storage_path, alt
      from product_images
     where product_id = p.id
     order by position, created_at
     limit 1
  ) pi on true
  where c.parent_id is null
    and c.is_active
    and c.deleted_at is null
    and p.status = 'published'
    and p.deleted_at is null
  order by c.id, (pi.storage_path is null), p.rating_avg desc nulls last, p.created_at;

comment on view public.v_category_tiles is
  'One row per top-level category with its published product count and a picture: the admin-set '
  'image_path when there is one, otherwise the best-rated photographed product in it. Empty categories '
  'do not appear. docs/05 §1.6, docs/13 §AJ.';

grant select on public.v_category_tiles to anon, authenticated, service_role;
