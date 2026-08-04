-- =============================================================================
-- 45 · M12 · Proposal images, and promoting a proposal to a draft product
-- Source: docs/16 §9.
-- =============================================================================

/*
 * ── Why a private bucket, when product images are public ──
 *
 * `product-images` is public: a product page's photos are served straight off the CDN, and its insert
 * policy is `has_any_role('{product_manager}')` — a merchant cannot write there, and should not be able
 * to. Uploading into it would put a **rejected** proposal's photos on a public URL forever, discoverable
 * by anyone who guesses the path, for a product BioCode decided not to list.
 *
 * So a proposal's images land in a private bucket, are reviewed through signed URLs, and are **copied**
 * into `product-images` only when the proposal is approved. That copy is the moment BioCode takes
 * responsibility for publishing somebody else's photograph, and it should be a deliberate act.
 *
 * 2 MB and the same four formats as `product-images`, so an image that passes here cannot fail there —
 * a merchant discovering its photo was too large *after* approval would be a poor way to find out.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'merchant-proposals', 'merchant-proposals', false, 2 * 1024 * 1024,
  array['image/webp', 'image/jpeg', 'image/png', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
 * Scoped exactly as the KYB bucket is: `proposals/<merchant_id>/…`, with the id read out of the path by
 * `(storage.foldername(name))[2]` and checked against `current_merchant_ids()`.
 *
 * Unlike KYB documents, **delete is granted to the owning merchant.** A registration certificate is
 * evidence of what a reviewer verified and must not be replaceable; a product photo is a photo, and a
 * merchant that uploaded the wrong one should be able to remove it before anybody looks. Update is still
 * absent — a correction is a delete and a new upload, so a path never quietly points at different bytes.
 */
create policy "merchant-proposals read" on storage.objects for select
  using (
    bucket_id = 'merchant-proposals'
    and (
      (select public.is_staff())
      or ((storage.foldername(name))[2])::uuid = any (public.current_merchant_ids())
    )
  );

create policy "merchant-proposals insert" on storage.objects for insert
  with check (
    bucket_id = 'merchant-proposals'
    and ((storage.foldername(name))[2])::uuid = any (public.current_merchant_ids())
  );

create policy "merchant-proposals delete" on storage.objects for delete
  using (
    bucket_id = 'merchant-proposals'
    and ((storage.foldername(name))[2])::uuid = any (public.current_merchant_ids())
  );

-- -----------------------------------------------------------------------------
-- Promoting an approved proposal to a draft product
-- -----------------------------------------------------------------------------

/*
 * ── What changed, and why it is not the thing §1 forbids ──
 *
 * Step 6 shipped with "approving a proposal creates no product", on the reasoning that a product needs a
 * slug, SEO copy, ingredients, images and a compliance pass, and that anything else would be
 * merchant-created listings with a delay.
 *
 * Two facts moved that line. `product_proposals.created_product_id` has existed since migration 28 and
 * was wired to nothing — the schema always anticipated this link. And **publishing requires
 * `compliance.approve`** (docs/06 §14), which the merchant does not have and the product manager does
 * not either.
 *
 * So this creates a **`draft`** product. A draft is invisible on the storefront: `search_products` only
 * returns `status = 'published'`, and so does `getProduct`. What a merchant's proposal now produces is a
 * head start for the catalogue team — a row with the name, the brand, the form and **the merchant's
 * photographs already attached** — and every judgement that matters still happens afterwards, by
 * somebody who holds the capability for it.
 *
 * The images themselves are copied by the calling action, not here: moving bytes between buckets needs
 * the storage API, and a plpgsql function cannot reach it.
 *
 * ── The price ──
 *
 * A variant cannot exist without one, so the merchant's **asking** price is written and the reviewer note
 * says so. That is a placeholder, not a decision: it is what the merchant wants for the unit, not what
 * BioCode would charge, and the two are different by exactly the margin somebody has to choose. A draft
 * cannot be bought, so the wrong number cannot cost anything before a human sees the field.
 */
create or replace function public.promote_proposal_to_draft(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal product_proposals%rowtype;
  v_payload jsonb;
  v_name text;
  v_brand_name text;
  v_brand_id uuid;
  v_slug text;
  v_candidate text;
  v_attempt int := 0;
  v_product_id uuid;
  v_variant_id uuid;
  v_price int;
begin
  if not (
    is_service_role()
    or has_any_role(array['product_manager', 'admin']::user_role[])
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_proposal from product_proposals where id = p_proposal_id for update;
  if v_proposal.id is null then
    raise exception 'PROPOSAL_NOT_FOUND';
  end if;

  -- Idempotent: a second approval, or a stale tab, must not mint a second product.
  if v_proposal.created_product_id is not null then
    return jsonb_build_object('created', false, 'product_id', v_proposal.created_product_id);
  end if;

  v_payload := coalesce(v_proposal.payload, '{}'::jsonb);
  v_name := nullif(trim(coalesce(v_payload->>'product_name', '')), '');
  v_brand_name := nullif(trim(coalesce(v_payload->>'brand_name', '')), '');

  if v_name is null or v_brand_name is null then
    raise exception 'PROPOSAL_INCOMPLETE';
  end if;

  /*
   * The brand, matched case-insensitively before being created.
   *
   * `brands.name` is not unique, so a second "Alpha Labs" is possible and would split one brand's
   * products across two pages. Matching on a lowered name first is what stops that; creating one when
   * nothing matches is the alternative to making a reviewer leave the screen, and a brand row is cheap
   * and editable.
   */
  select id into v_brand_id
    from brands
   where lower(name) = lower(v_brand_name)
   order by created_at
   limit 1;

  if v_brand_id is null then
    insert into brands (slug, name, is_active)
    values (
      -- Same slug rule as the merchant's own: fold diacritics rather than dropping the letter.
      regexp_replace(
        regexp_replace(lower(extensions.unaccent(v_brand_name)), '[^a-z0-9]+', '-', 'g'),
        '(^-+|-+$)', '', 'g'
      ),
      v_brand_name,
      true
    )
    returning id into v_brand_id;
  end if;

  -- A free slug, bounded. Four collisions on a product name means the name is the problem.
  v_slug := regexp_replace(
    regexp_replace(lower(extensions.unaccent(v_name)), '[^a-z0-9]+', '-', 'g'),
    '(^-+|-+$)', '', 'g'
  );
  if v_slug = '' then
    v_slug := 'produkt';
  end if;

  v_candidate := v_slug;
  while exists (select 1 from products where slug = v_candidate) and v_attempt < 8 loop
    v_attempt := v_attempt + 1;
    v_candidate := v_slug || '-' || (v_attempt + 1);
  end loop;

  if exists (select 1 from products where slug = v_candidate) then
    raise exception 'SLUG_EXHAUSTED:%', v_slug;
  end if;

  insert into products (slug, brand_id, name, form, status)
  values (
    v_candidate,
    v_brand_id,
    -- Both locales get the merchant's words; translating them is the catalogue team's job.
    jsonb_build_object('sq', v_name, 'en', v_name),
    nullif(trim(coalesce(v_payload->>'form', '')), ''),
    'draft'
  )
  returning id into v_product_id;

  v_price := greatest(0, coalesce((v_payload->>'asking_price_cents')::int, 0));

  insert into product_variants (product_id, sku, name, price_cents, is_default, is_active, position)
  values (
    v_product_id,
    -- Deterministic and obviously provisional, so nobody mistakes it for a real supplier code.
    'PROP-' || upper(substr(replace(p_proposal_id::text, '-', ''), 1, 8)),
    jsonb_build_object(
      'sq', coalesce(nullif(trim(coalesce(v_payload->>'variant_name', '')), ''), 'Standard'),
      'en', coalesce(nullif(trim(coalesce(v_payload->>'variant_name', '')), ''), 'Standard')
    ),
    v_price,
    true,
    true,
    0
  )
  returning id into v_variant_id;

  update product_proposals
     set created_product_id = v_product_id
   where id = p_proposal_id;

  return jsonb_build_object(
    'created', true,
    'product_id', v_product_id,
    'variant_id', v_variant_id,
    'slug', v_candidate,
    'brand_id', v_brand_id,
    'provisional_price_cents', v_price
  );
end $$;

comment on function public.promote_proposal_to_draft is
  'Creates a draft product from an approved proposal. Draft, because publishing needs compliance.approve. docs/16 §9.';

revoke all on function public.promote_proposal_to_draft(uuid) from public, anon;
grant execute on function public.promote_proposal_to_draft(uuid) to authenticated, service_role;
