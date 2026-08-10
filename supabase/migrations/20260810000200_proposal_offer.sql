-- 79 · An approved proposal mints the merchant's offer
--
-- Until now, approving a proposal created a draft product and stopped. The merchant then had to find
-- that product in the offer picker and re-type stock, price, SKU and handling days it had already
-- written into the proposal. For a 200-row batch that is 200 forms after the approval, and it was the
-- reason the flow read as two steps for one intention (owner, 2026-08-10).
--
-- The merchant now states its offer terms once, in the proposal. Approval creates the product *and* the
-- offer, and the offer is **live the moment compliance publishes the product** — the owner's decision,
-- and defensible because the reviewer approving the proposal has just read those exact terms.
--
-- ── Why that is safe, stated as the invariant it depends on ──
--
-- An offer created here is `status = 'approved'` against a product that is still `draft`. Nothing can
-- buy it, and there are now two independent reasons:
--
--   1. `variant_buy_box` only considers offers whose merchant is approved and whose own status is
--      approved — and, as of this migration, only variants of a **published** product.
--   2. The storefront never learns the variant id of a draft product: RLS on `products` for the anon
--      role is `status = 'published'`.
--
-- (1) was implicit before and is now written down. It had been true only because no caller happened to
-- pass a draft variant id, which is a property of today's call sites rather than a guarantee — and this
-- migration is precisely the change that starts creating approved offers on unpublished products.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · Where the outcome is recorded
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The merchant's *inputs* stay in `payload`, beside `asking_price_cents` and `stock_on_hand` which are
-- already there. What lands in columns is workflow state — the thing a queue has to read cheaply and a
-- retry has to be honest about.
alter table product_proposals
  add column if not exists created_offer_id uuid references merchant_offers(id) on delete set null,
  add column if not exists offer_created_at timestamptz,
  add column if not exists offer_attempts smallint not null default 0,
  add column if not exists offer_error text;

comment on column product_proposals.created_offer_id is
  'The merchant offer minted from this proposal. Nullable and ON DELETE SET NULL: a merchant may delete '
  'its own offer, and that must not resurrect it on the next sweep — see offer_created_at.';

comment on column product_proposals.offer_created_at is
  'When the offer was minted. THIS, not created_offer_id, is the idempotency key: the FK nulls out when '
  'a merchant deletes the offer, and keying on it would have the nightly sweep recreate something the '
  'merchant deliberately removed.';

comment on column product_proposals.offer_attempts is
  'Bounded retry. A row whose terms can never satisfy the merchant_offers CHECKs would otherwise fail '
  'every night forever while holding a slot at the head of the queue.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · The buy box learns about product status
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.variant_buy_box(p_variant_ids uuid[])
returns table (
  variant_id uuid,
  source text,
  stock_status text,
  merchant_id uuid,
  merchant_slug text,
  merchant_name text,
  offer_id uuid,
  handling_days int,
  supplier_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with wanted as (
    select distinct unnest(p_variant_ids) as variant_id
  ),
  biocode as (
    select il.variant_id,
           sum(il.on_hand) as on_hand,
           max(il.low_stock_threshold) as threshold
      from inventory_levels il
     where il.variant_id = any (p_variant_ids)
     group by il.variant_id
  ),
  live_offers as (
    select o.id,
           o.variant_id,
           o.merchant_id,
           o.stock_on_hand,
           o.low_stock_threshold,
           o.handling_days,
           m.slug,
           m.display_name,
           /*
            * Cheapest first, then the better-rated merchant, then the offer that has been there
            * longest. Every term is deterministic, so two calls a second apart cannot disagree
            * about who is in the buy box.
            */
           row_number() over (
             partition by o.variant_id
             order by o.price_cents asc, m.rating_avg desc, o.created_at asc, o.id asc
           ) as rank,
           count(*) over (partition by o.variant_id) as rivals
      from merchant_offers o
      join merchants m on m.id = o.merchant_id
     where o.variant_id = any (p_variant_ids)
       and o.status = 'approved'
       and o.stock_on_hand > 0
       -- Suspended and rejected merchants leave the buy box the moment their status changes.
       and m.status = 'approved'
       /*
        * The publication gate, added by migration 79.
        *
        * Approving a proposal now mints an *approved* offer against a product that is still a draft,
        * so "the storefront never asks about a draft variant" stopped being safe to rely on — that was
        * a property of today's call sites, not a guarantee. This function is `security definer` and is
        * therefore the one place RLS is not doing the work, so the rule belongs here.
        */
       and exists (
         select 1
           from product_variants pv
           join products p on p.id = pv.product_id
          where pv.id = o.variant_id
            and p.status = 'published'
            and p.deleted_at is null
       )
  ),
  winner as (
    select * from live_offers where rank = 1
  )
  select
    w.variant_id,
    case
      when coalesce(b.on_hand, 0) > 0 then 'biocode'
      when o.id is not null then 'merchant'
      else 'none'
    end as source,
    case
      when coalesce(b.on_hand, 0) > 0 then
        case when b.on_hand <= coalesce(b.threshold, 0) then 'low' else 'in_stock' end
      when o.id is not null then
        case when o.stock_on_hand <= o.low_stock_threshold then 'low' else 'in_stock' end
      else 'out_of_stock'
    end as stock_status,
    case when coalesce(b.on_hand, 0) > 0 then null else o.merchant_id end as merchant_id,
    case when coalesce(b.on_hand, 0) > 0 then null else o.slug end as merchant_slug,
    case when coalesce(b.on_hand, 0) > 0 then null else o.display_name end as merchant_name,
    case when coalesce(b.on_hand, 0) > 0 then null else o.id end as offer_id,
    case when coalesce(b.on_hand, 0) > 0 then null else o.handling_days end as handling_days,
    /*
     * How many suppliers could serve this variant, BioCode included. It answers "is this a
     * single-source line?" on the routing screen without a second query, and on the storefront it
     * is only ever rendered as a count.
     */
    (case when coalesce(b.on_hand, 0) > 0 then 1 else 0 end + coalesce(o.rivals, 0))::int
      as supplier_count
    from wanted w
    left join biocode b on b.variant_id = w.variant_id
    left join winner o on o.variant_id = w.variant_id
$$;

comment on function public.variant_buy_box is
  'Who sells a variant and whether it is buyable. House stock wins; otherwise the cheapest approved '
  'offer from an approved merchant on a PUBLISHED product. docs/16 §5, §9; migration 79 for the '
  'publication gate.';

revoke all on function public.variant_buy_box(uuid[]) from public;
grant execute on function public.variant_buy_box(uuid[]) to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · Minting the offer
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A separate function from `promote_proposal_to_draft`, deliberately. Promotion copies every photograph
-- between storage buckets — many round trips, non-transactional, counted and reported per file. This is
-- one INSERT. Fusing them would mean a term that violates a `merchant_offers` CHECK rolls back a
-- product that was perfectly fine, the row returns to `proposals_awaiting_promotion` with
-- `created_product_id is null`, and the nightly housekeeping cron goes red on that one row forever.
create or replace function public.create_offer_from_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal product_proposals%rowtype;
  v_payload jsonb;
  v_variant_id uuid;
  v_price int;
  v_stock int;
  v_threshold int;
  v_handling int;
  v_sku text;
  v_offer_id uuid;
  v_max_handling int;
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

  -- Idempotent on the timestamp, never on the FK. See the column comment.
  if v_proposal.offer_created_at is not null then
    return jsonb_build_object('created', false, 'offer_id', v_proposal.created_offer_id);
  end if;

  if v_proposal.status <> 'approved' or v_proposal.created_product_id is null then
    return jsonb_build_object('created', false, 'reason', 'not_promoted');
  end if;

  -- The variant promotion made. One per proposal-born product, and it is the default.
  select id into v_variant_id
    from product_variants
   where product_id = v_proposal.created_product_id
   order by is_default desc, position, created_at
   limit 1;

  if v_variant_id is null then
    return jsonb_build_object('created', false, 'reason', 'no_variant');
  end if;

  v_payload := coalesce(v_proposal.payload, '{}'::jsonb);

  /*
   * Regex-guarded before every cast.
   *
   * `payload` is jsonb the merchant's form wrote, and a bare `(payload->>'handling_days')::int` on
   * anything non-numeric raises 22P02 — inside a definer function called by a cron, that is an
   * exception nobody reads. Guarding means a malformed term is *recorded* against the proposal instead,
   * where a reviewer can see it.
   */
  v_price := case
    when coalesce(v_payload->>'asking_price_cents', '') ~ '^[0-9]{1,9}$'
      then (v_payload->>'asking_price_cents')::int
    else null
  end;
  v_stock := case
    when coalesce(v_payload->>'stock_on_hand', '') ~ '^[0-9]{1,9}$'
      then (v_payload->>'stock_on_hand')::int
    else 0
  end;
  v_threshold := case
    when coalesce(v_payload->>'low_stock_threshold', '') ~ '^[0-9]{1,9}$'
      then (v_payload->>'low_stock_threshold')::int
    else 3
  end;
  v_handling := case
    when coalesce(v_payload->>'handling_days', '') ~ '^[0-9]{1,3}$'
      then (v_payload->>'handling_days')::int
    else 1
  end;
  v_sku := nullif(trim(coalesce(v_payload->>'merchant_sku', '')), '');

  -- Clamped to the marketplace ceiling rather than refused: the settings row can drop below what was
  -- valid when the merchant submitted, and a proposal approved weeks later must not fail on that.
  select coalesce((value->>'max_handling_days')::int, 30) into v_max_handling
    from settings where key = 'marketplace';
  v_handling := least(greatest(v_handling, 0), least(coalesce(v_max_handling, 30), 30));

  if v_price is null or v_price <= 0 then
    update product_proposals
       set offer_attempts = offer_attempts + 1,
           offer_error = 'asking_price_cents missing or not a positive integer'
     where id = p_proposal_id;
    return jsonb_build_object('created', false, 'reason', 'invalid_price');
  end if;

  /*
   * `status = 'approved'` with `approved_at` set: the offer is live as soon as the product is published.
   *
   * `approved_by` stays NULL on purpose. The only candidate is `auth.uid()`, which is NULL when the
   * nightly cron calls this as the service role — so half the offers would name an approver and half
   * would not, from the same decision. A NULL that always means "minted by proposal approval" is more
   * honest than a column that is sometimes a person and sometimes nothing.
   */
  insert into merchant_offers (
    merchant_id, variant_id, merchant_sku, price_cents,
    stock_on_hand, low_stock_threshold, handling_days, status, approved_at
  ) values (
    v_proposal.merchant_id, v_variant_id, v_sku, v_price,
    greatest(v_stock, 0), greatest(v_threshold, 0), v_handling, 'approved', now()
  )
  on conflict (merchant_id, variant_id) do nothing
  returning id into v_offer_id;

  /*
   * The conflict path is not an error. Two proposals from one merchant can promote onto the same
   * variant, and a merchant may have created the offer by hand between approval and the sweep. Adopting
   * the existing row makes the proposal stop asking, which is the outcome either way.
   */
  if v_offer_id is null then
    select id into v_offer_id
      from merchant_offers
     where merchant_id = v_proposal.merchant_id and variant_id = v_variant_id;
  end if;

  update product_proposals
     set created_offer_id = v_offer_id,
         offer_created_at = now(),
         offer_error = null
   where id = p_proposal_id;

  return jsonb_build_object('created', true, 'offer_id', v_offer_id, 'variant_id', v_variant_id);
end $$;

comment on function public.create_offer_from_proposal is
  'Mints the merchant offer for an approved, promoted proposal. Idempotent on offer_created_at. The '
  'offer is approved so it goes live when compliance publishes the product (owner, 2026-08-10); '
  'variant_buy_box refuses unpublished products. docs/16 §9.';

revoke all on function public.create_offer_from_proposal(uuid) from public;
grant execute on function public.create_offer_from_proposal(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · The queue, derived rather than flagged
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Same shape as `proposals_awaiting_promotion`: a row leaves by being *done*, so two sweeps racing on
-- one row both call an idempotent function and the second gets `created: false`. There is no claimed
-- flag to leak when a run dies halfway.
create or replace view public.proposals_awaiting_offer with (security_invoker = on) as
  select id, merchant_id, created_product_id, reviewed_at, offer_attempts
    from product_proposals
   where status = 'approved'
     and created_product_id is not null
     and offer_created_at is null
     and offer_attempts < 3;

comment on view public.proposals_awaiting_offer is
  'Approved and promoted proposals whose offer has not been minted yet, under the retry cap. Drained by '
  'the housekeeping cron. docs/16 §9.';

grant select on public.proposals_awaiting_offer to authenticated, service_role;
