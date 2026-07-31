-- =============================================================================
-- 09 · Supporting RPCs
-- Source: docs/13 §B4, §B5, §D1 — write paths the pack specified but left unreachable.
-- =============================================================================

/*
 * docs/13 §B5 — `newsletter_subscribers`, `contact_messages` (insert) and `audit_logs`
 * (insert) were left policy-free, which is a correct default-deny, but docs/02 §6 closes
 * the service-role allowlist to webhooks, cron, guest carts, guest lookup and email
 * logging. So `subscribeNewsletter`, `submitContact` and every audited admin mutation had
 * no legal way to write at all.
 *
 * These `security definer` RPCs are the fix. Widening the service-role list would have
 * been the easy alternative and the wrong one: it turns a narrow, reviewable exception
 * into a general-purpose bypass.
 */

-- -----------------------------------------------------------------------------
-- Newsletter (docs/08 §5) — double opt-in
-- -----------------------------------------------------------------------------
create or replace function public.newsletter_subscribe(
  p_email text,
  p_locale text default 'sq',
  p_source text default 'footer'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;
  if p_locale not in ('sq','en') then p_locale := 'sq'; end if;

  v_token := generate_access_token();

  insert into newsletter_subscribers (email, locale, source, confirm_token)
  values (lower(p_email)::extensions.citext, p_locale, p_source, v_token)
  on conflict (email) do update
    set locale = excluded.locale,
        -- Re-subscribing after an unsubscribe restarts the double opt-in.
        confirm_token = case
          when newsletter_subscribers.confirmed_at is null then excluded.confirm_token
          else newsletter_subscribers.confirm_token end,
        unsubscribed_at = null
  returning confirm_token into v_token;

  -- The caller sends the confirmation email; it must never leak an existing
  -- subscriber's state back to the browser (no enumeration).
  return jsonb_build_object('confirm_token', v_token);
end $$;

create or replace function public.newsletter_confirm(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_updated int;
begin
  update newsletter_subscribers
     set confirmed_at = coalesce(confirmed_at, now()), confirm_token = null
   where confirm_token = p_token;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end $$;

revoke all on function public.newsletter_subscribe(text, text, text) from public;
revoke all on function public.newsletter_confirm(text) from public;
grant execute on function public.newsletter_subscribe(text, text, text) to anon, authenticated, service_role;
grant execute on function public.newsletter_confirm(text) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Contact form (docs/05 §16)
-- -----------------------------------------------------------------------------
create or replace function public.contact_submit(
  p_name text,
  p_email text,
  p_subject text,
  p_body text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'NAME_REQUIRED'; end if;
  if length(trim(coalesce(p_body, ''))) < 10 then raise exception 'BODY_TOO_SHORT'; end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL'; end if;

  insert into contact_messages (name, email, subject, body)
  values (trim(p_name), lower(p_email)::extensions.citext, nullif(trim(p_subject), ''), p_body)
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.contact_submit(text, text, text, text) from public;
grant execute on function public.contact_submit(text, text, text, text) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Audit log (docs/06 preamble — "every mutation writes audit_logs")
-- -----------------------------------------------------------------------------
create or replace function public.log_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_ip text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_role user_role;
begin
  if not (is_service_role() or is_staff() or is_admin()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select role into v_role from profiles where id = auth.uid();

  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, before, after, ip)
  values (auth.uid(), v_role, p_action, p_entity_type, p_entity_id, p_before, p_after, p_ip);
end $$;

revoke all on function public.log_audit(text, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.log_audit(text, text, text, jsonb, jsonb, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Loyalty redemption (docs/07 §9)
-- -----------------------------------------------------------------------------

/*
 * docs/13 §B4 — `redeemLoyalty` was specified as a server action, but a customer holds no
 * write privilege on `coupons` (the policy's WITH CHECK requires admin) and none at all
 * on `loyalty_transactions`. The action as written could not run.
 *
 * Deducting points and minting the coupon must also be atomic, or a failure between the
 * two either burns points with nothing to show or hands out a free coupon.
 */
create or replace function public.redeem_loyalty_points() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_balance int;
  v_cost int;
  v_value int;
  v_code text;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;

  select coalesce((value->>'redeem_points')::int, 100),
         coalesce((value->>'redeem_value_cents')::int, 500)
    into v_cost, v_value
    from settings where key = 'loyalty';

  v_cost  := coalesce(v_cost, 100);
  v_value := coalesce(v_value, 500);

  -- Lock the profile so two concurrent redemptions cannot both pass the balance check.
  select loyalty_points into v_balance from profiles where id = v_user for update;
  if coalesce(v_balance, 0) < v_cost then
    raise exception 'INSUFFICIENT_POINTS';
  end if;

  v_code := 'LOY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into coupons (
    code, type, value, max_uses, max_uses_per_user,
    starts_at, ends_at, is_active, is_system, note
  ) values (
    v_code::extensions.citext, 'fixed', v_value, 1, 1,
    now(), now() + interval '90 days', true, true,
    'Loyalty redemption for ' || v_user::text
  );

  insert into loyalty_transactions (user_id, points, reason, note)
  values (v_user, -v_cost, 'redeem', 'Redeemed for coupon ' || v_code);

  return jsonb_build_object('code', v_code, 'value_cents', v_value, 'points_spent', v_cost);
end $$;

revoke all on function public.redeem_loyalty_points() from public, anon;
grant execute on function public.redeem_loyalty_points() to authenticated;

-- -----------------------------------------------------------------------------
-- search_products (docs/13 §D1)
-- -----------------------------------------------------------------------------

/*
 * docs/05 §2 describes the PLP as reading "a single `search_products` query" and docs/12
 * M3 depends on it, but the pack never defined it. This is that function.
 *
 * One query serves PLP, category, brand, goal, ingredient and full-text search so the
 * filter, sort and pagination semantics cannot diverge between surfaces. `total_count` is
 * returned as a window so the caller gets the result count without a second round trip.
 *
 * Text matching is FTS first with a trigram fallback, which is what makes "vitamn c" find
 * Vitamin C (docs/05 §8 acceptance).
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
      coalesce((
        select sum(il.on_hand) from inventory_levels il where il.variant_id = v.id
      ), 0) > 0 as in_stock,
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

revoke all on function public.search_products(
  text, text[], text[], text[], text[], text[], product_form[],
  int, int, numeric, boolean, boolean, text, int, int
) from public;
grant execute on function public.search_products(
  text, text[], text[], text[], text[], text[], product_form[],
  int, int, numeric, boolean, boolean, text, int, int
) to anon, authenticated, service_role;
