-- 82 · The homepage category row, as a view
--
-- The row was six pale rectangles carrying only a name, and one of them — `equipments`, rendered as
-- "BioGear" — had zero published products, so a tile that looked like a destination was a dead end.
--
-- Rebuilding it needs three things per category that the taxonomy read does not carry: how many products
-- are in it, one real photograph to show, and the alt text for that photograph. `categories.image_path`
-- is null on every row and `icon` is set on exactly one, so there is no category artwork to lean on; what
-- exists is product photography, and the honest picture of a shelf is something actually on it.
--
-- ── Why a view and not an embedded select ──
--
-- Expressed through PostgREST this is a two-level embed with filters on the inner resource and a
-- pick-the-best-one per group, which is a lot of syntax to get subtly wrong — and it was: the first
-- attempt returned nothing and the row silently vanished from the homepage. `distinct on` is the
-- straightforward way to say "one row per category, best first", it is testable on its own, and the
-- storefront read becomes an ordinary select.
--
-- `security_invoker` so the anonymous role's own policies apply: `products` is restricted to published
-- and `categories` to active, which is what keeps a draft product's photograph off the homepage without
-- this view having to repeat the rule.
create or replace view public.v_category_tiles with (security_invoker = on) as
  select distinct on (c.id)
    c.id            as category_id,
    c.slug,
    c.name,
    c.sort_order,
    count(*) over (partition by c.id)::int as product_count,
    pi.storage_path as image_path,
    coalesce(pi.alt, p.name) as image_alt
  from categories c
  join product_categories pc on pc.category_id = c.id
  join products p on p.id = pc.product_id
  /*
   * `left` on the images: a category whose products are all unphotographed still has a count and a name,
   * and the component draws a tinted panel for it. An inner join here would have hidden five of the six
   * categories on the day this shipped, which is the failure mode of designing for assets you wish you
   * had.
   */
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
  /*
   * One row per category: the best-rated product that has a photograph, falling back to the best-rated
   * product at all. `image_path is null last` is what makes the photographed one win — without it a
   * five-star product with no picture would leave the tile blank.
   */
  order by c.id, (pi.storage_path is null), p.rating_avg desc nulls last, p.created_at;

comment on view public.v_category_tiles is
  'One row per top-level category with its published product count and a representative product '
  'photograph, for the homepage category row. Empty categories do not appear. docs/05 §1.6.';

grant select on public.v_category_tiles to anon, authenticated, service_role;
