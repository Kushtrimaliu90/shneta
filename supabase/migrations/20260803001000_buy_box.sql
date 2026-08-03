-- =============================================================================
-- 32 · M12 · The buy box, and one read path for offer detail
-- Source: docs/16 §1, §5, §11.
-- =============================================================================

/*
 * Who supplies a variant, decided in one place.
 *
 * BioCode stock always wins. Otherwise the cheapest approved, in-stock offer from an approved
 * merchant, tie-broken by merchant rating and then by the oldest offer — so a merchant who listed
 * first is not displaced by a newer one that happens to match its price to the cent.
 *
 * ── Why a security-definer function rather than a view the storefront joins ──
 *
 * It reads two tables anon cannot see: `inventory_levels` is staff-only, and `merchant_offers` is
 * scoped to `current_merchant_ids()`, which returns `{}` for a shopper. A definer function is the
 * same device `v_product_stock` uses for exactly the same reason (migration 12), and it keeps the
 * selection rule in one place instead of in every caller that needs to know who is selling.
 *
 * ── What it deliberately does not return ──
 *
 * No unit counts, from either side. Stock is bucketed to the same three words the PDP already
 * shows, so a competitor cannot sit on the endpoint and infer sales velocity — the whole point of
 * the bucketing in docs/13 §B7, which a per-merchant count would undo.
 *
 * No prices either, and that is worth stating plainly because it is the marketplace's central
 * pricing decision:
 *
 *   **The canonical variant price is the only customer-facing price.** A merchant offer is
 *   *supply*, not a listing. `merchant_offers.price_cents` is what the merchant asks BioCode for
 *   the unit — the number the buy box sorts on and the number admin weighs at approval and at
 *   routing — and it never reaches the storefront. One product, one page, one price, whoever
 *   happens to have the stock.
 *
 * The alternative — the winning offer prices the line — was rejected: routing happens *after* the
 * order exists (§6), so the merchant who priced it need not be the merchant who ships it, and the
 * customer would have paid a price belonging to a supplier who never touched the parcel.
 */
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
  'Who supplies each variant: BioCode first, else the cheapest approved in-stock offer. Bucketed stock, no prices. docs/16 §1.';

/*
 * Anon executes this: it powers the PDP, which is a static page for a shopper who is not signed in.
 * `public` is revoked first so the grant is an explicit list rather than whatever `public` happens
 * to carry.
 */
revoke all on function public.variant_buy_box(uuid[]) from public;
grant execute on function public.variant_buy_box(uuid[]) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Offer detail — one view, two audiences
-- -----------------------------------------------------------------------------

/*
 * Everything an offer needs around it to be understood: which product, at what retail price, and
 * what the merchant would actually receive for selling one.
 *
 * `security_invoker = on`, which is what makes one view serve both audiences without a flag: RLS
 * runs as the caller, so a merchant sees its own offers and staff see all of them. Writing two
 * near-identical queries and keeping their column lists in step is how they drift.
 *
 * `merchant_due_cents` is computed from the **retail** price, not from the asking price, because
 * that is what settlement will actually pay: the customer pays the canonical price, and the
 * merchant receives it less commission. Showing the merchant that number next to its own asking
 * price is the whole transparency the terms promise — and for the reviewer it is the signal that
 * matters, since an offer asking more than settlement pays is one BioCode would lose money routing.
 */
create or replace view v_merchant_offer_detail with (security_invoker = on) as
  select
    o.id,
    o.merchant_id,
    m.display_name as merchant_name,
    m.slug         as merchant_slug,
    m.status       as merchant_status,
    m.commission_pct,
    o.variant_id,
    pv.sku,
    pv.name        as variant_name,
    pv.options     as variant_options,
    pv.price_cents as retail_price_cents,
    pv.is_active   as variant_active,
    p.id           as product_id,
    p.slug         as product_slug,
    p.name         as product_name,
    p.status       as product_status,
    o.merchant_sku,
    o.price_cents  as asking_price_cents,
    o.stock_on_hand,
    o.low_stock_threshold,
    o.handling_days,
    o.status,
    o.rejection_note,
    o.approved_at,
    o.created_at,
    o.updated_at,
    (public.merchant_settlement(o.merchant_id, pv.price_cents) ->> 'merchant_due_cents')::int
      as merchant_due_cents
  from merchant_offers o
  join merchants m on m.id = o.merchant_id
  join product_variants pv on pv.id = o.variant_id
  join products p on p.id = pv.product_id;

comment on view v_merchant_offer_detail is
  'An offer with its product, its retail price and what settlement would pay for it. RLS-scoped: own offers for a merchant, all for staff. docs/16 §5, §11.';

grant select on v_merchant_offer_detail to authenticated, service_role;
