-- =============================================================================
-- 46 · M12 · promote_proposal_to_draft — the form is an enum, and the merchant types prose
-- Source: docs/16 §9; the trap is docs/13 §X11.
-- =============================================================================

/*
 * `column "form" is of type product_form but expression is of type text`.
 *
 * The same trap as §X1 and §X2, for the third time in this milestone: `nullif(trim(…), '')` is `text`,
 * `products.form` is `product_form`, and plpgsql deferred the complaint to the first call.
 *
 * ── But a cast alone would have been worse than the error ──
 *
 * `product_form` has ten values. The proposal form asks for the form as **free text**, deliberately —
 * its own comment says "a merchant knows forms BioCode does not" — so a merchant may perfectly
 * reasonably type "effervescent tablets", "drops" or "pluhur". A bare `::product_form` would then throw
 * on a valid proposal, and the reviewer would see a promotion fail for a reason that looked like a bug in
 * the software rather than a mismatch between a free-text field and a closed set.
 *
 * So the value is taken **only when it names an enum member**, and left null otherwise. The merchant's
 * own words are still in `payload.form` and still on the review card, so nothing is lost: the reviewer
 * reads "effervescent tablets" and picks the closest form in the editor, which is a judgement they were
 * always going to make.
 *
 * Matched case-insensitively and singularised loosely, because "Capsules" and "capsule" are the same
 * answer and refusing one of them teaches merchants to guess at our vocabulary.
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
  v_form_text text;
  v_form product_form;
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
   * The form, only if the merchant happened to name one of ours. `regexp_replace` drops a trailing "s"
   * so "capsules" lands on `capsule`; anything else stays null for the reviewer to choose.
   */
  v_form_text := lower(trim(coalesce(v_payload->>'form', '')));
  v_form_text := regexp_replace(v_form_text, 's$', '');

  if v_form_text = any (enum_range(null::product_form)::text[]) then
    v_form := v_form_text::product_form;
  else
    v_form := null;
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
    v_form,
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
    'form', v_form,
    'provisional_price_cents', v_price
  );
end $$;
