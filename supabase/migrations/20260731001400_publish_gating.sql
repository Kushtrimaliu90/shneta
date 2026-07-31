-- =============================================================================
-- Publish gating (docs/06 §3 acceptance, docs/07 §10)
--
-- The spec is explicit: publishing a product requires at least one active variant, at
-- least one image, a primary category, and compliance approval. None of that was
-- enforced anywhere. RLS decides *who* may write to `products`; it cannot express
-- "only if this other table has a row", so a product manager could set
-- `status = 'published'` on an empty draft and it would appear in the storefront,
-- the sitemap and the search index with no price and no picture.
--
-- This is the same argument as `orders_before_status_change` (docs/07 §7.1): the check
-- needs the row's *current* state at the moment of the write, so no amount of validation
-- in a server action can replace it — two editors, or one editor and a script, and the
-- application-level check loses the race. The action still checks first, because a
-- friendly message beats a raised exception; this is what makes the rule true.
--
-- Deliberately NOT enforced here: that `draft → published` must pass through
-- `pending_review`. A compliance manager fixing a typo on a live product should not have
-- to demote it and re-approve it, and the approval requirement below already means an
-- unreviewed product cannot go live. The workflow is guided by the UI; the invariant that
-- matters — nothing publishes without approval — is guarded.
-- =============================================================================

create or replace function public.guard_product_publish() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_variants int;
  v_images int;
  v_primary int;
begin
  -- Only interested in the moment a product becomes published.
  if new.status <> 'published' or old.status = 'published' then
    return new;
  end if;

  /*
   * docs/07 §10 — approval is compliance's to give. `approved_by` is set by the approve
   * action; requiring it here means a product manager cannot publish by writing the status
   * column directly, whatever the UI offers them.
   *
   * The service role is exempt: seeds and the production bootstrap publish the real
   * catalogue without a human approver, exactly as they create the first admin (docs/13 §A4).
   */
  if not is_service_role() and new.approved_by is null then
    raise exception 'PUBLISH_REQUIRES_APPROVAL' using errcode = '42501';
  end if;

  select count(*) into v_variants
    from product_variants where product_id = new.id and is_active;
  if v_variants = 0 then
    raise exception 'PUBLISH_REQUIRES_VARIANT' using errcode = '23514';
  end if;

  select count(*) into v_images from product_images where product_id = new.id;
  if v_images = 0 then
    raise exception 'PUBLISH_REQUIRES_IMAGE' using errcode = '23514';
  end if;

  select count(*) into v_primary
    from product_categories where product_id = new.id and is_primary;
  if v_primary = 0 then
    raise exception 'PUBLISH_REQUIRES_PRIMARY_CATEGORY' using errcode = '23514';
  end if;

  -- docs/05 §3 — `published_at` drives "new in" ordering and the sitemap's lastmod, so it is
  -- stamped once, on first publish, and left alone when a published product is edited.
  if new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end $$;

create trigger products_publish_guard
  before update on products
  for each row execute function public.guard_product_publish();

/*
 * Slug immutability after publish (CLAUDE.md §10).
 *
 * A slug is a URL. Changing one on a published product breaks every inbound link, every
 * share, and the canonical the search engine has already indexed — and it does so silently,
 * because the old URL 404s rather than erroring anywhere an operator would see.
 *
 * Separate trigger from the publish guard because it fires on a different condition: this
 * one cares about products that are *already* published, that one about products becoming
 * published.
 */
create or replace function public.guard_slug_immutable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.published_at is not null
     and new.slug is distinct from old.slug
     and not is_service_role()
  then
    raise exception 'SLUG_IMMUTABLE_AFTER_PUBLISH' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger products_slug_guard
  before update on products
  for each row execute function public.guard_slug_immutable();

/*
 * Exactly one default variant per product (docs/06 §3.2).
 *
 * `product_variants.is_default` had no constraint, so two defaults were possible — and the
 * PDP picks `variants.find(v => v.isDefault)`, which would silently take whichever the
 * database returned first. A partial unique index makes it impossible rather than unlikely.
 *
 * Note this permits *zero* defaults: `primaryVariant()` falls back to the first variant, and
 * forcing a default at insert time would make creating the first variant of a product a
 * two-statement dance.
 */
create unique index if not exists one_default_variant
  on product_variants (product_id) where is_default;
