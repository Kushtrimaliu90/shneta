-- =============================================================================
-- 76 · Sponsored placements on the listing pages
-- Source: the placement brief, Part 6. This is a revenue product.
-- =============================================================================

/*
 * ── Counting, without tracking ──
 *
 * The brief needs impressions and clicks per placement per date range, and it needs to stay outside
 * consent-banner scope. Those pull in opposite directions only if you store an event per view.
 *
 * So there is no events table. `ad_placement_stats` is one row per placement per **day**, incremented
 * in place. There is nothing in it to attribute to a person — no id, no address, no session, no
 * timestamp finer than a date — so there is nothing to disclose, export or erase, and the reporting
 * requirement is met exactly.
 *
 * It is also the cheap shape. This project has already been billed 22.8M external requests once; a
 * row per impression on every shop page view is the same mistake wearing a different hat. An upsert
 * into a table that stays at (placements × days) rows will not become a bill.
 *
 * ── Paid placement buys the banner, not the grid ──
 *
 * Nothing here touches `search_products`. Ranking is unchanged and cannot be bought, which is a
 * position worth being able to state plainly to both merchants and shoppers.
 */

create type ad_placement_status as enum ('draft', 'pending_review', 'approved');

create table ad_placements (
  id uuid primary key default gen_random_uuid(),

  advertiser_name text not null check (length(btrim(advertiser_name)) between 2 and 120),
  /** Optional link to the merchant record, when the advertiser is one of ours. */
  merchant_id uuid references merchants(id) on delete set null,
  internal_note text,

  headline jsonb not null default '{}'::jsonb,
  subhead jsonb not null default '{}'::jsonb,
  cta_label jsonb not null default '{}'::jsonb,

  /*
   * Absolute https, or a site path. Not http — a mixed-content banner would be blocked and the
   * advertiser would be paying for a link nobody can follow. Not `javascript:` or anything else: this
   * value is an advertiser-supplied string that ends up in an `href`.
   */
  destination_url text not null check (destination_url ~ '^(https://|/(?!/))'),
  open_in_new_tab boolean not null default false,

  image_desktop_path text,
  image_desktop_alt jsonb not null default '{}'::jsonb,
  image_mobile_path text,
  image_mobile_alt jsonb not null default '{}'::jsonb,

  /*
   * Disclosure, as data rather than as a styling choice.
   *
   * True means the "Sponsored" label renders, and there is deliberately no admin control to turn it
   * off — a paid placement that can be made to look organic is the whole problem the label exists to
   * prevent. BioCode's own promotions set this false and carry no label, because they are not paid
   * and calling them sponsored would be its own kind of lie.
   */
  is_paid boolean not null default true,

  status ad_placement_status not null default 'draft',
  approved_by uuid references profiles(id),
  approved_at timestamptz,

  /*
   * Empty means "every listing page". Slugs rather than ids so a placement survives a category being
   * rebuilt, and because the page already knows its own slug — no join to resolve targeting.
   */
  target_category_slugs text[] not null default '{}',
  target_brand_slugs text[] not null default '{}',

  /**
   * Share of rotation, 1–100.
   *
   * Implemented as **order**, not as duplication: the qualifying placements are sorted by weight and
   * the carousel shows them in that order, so the highest weight occupies slide one and is the one
   * every visitor sees. Repeating a placement to weight it would put eight slides behind five dots,
   * which is a worse lie to the shopper than a simple ordering is to the advertiser.
   */
  weight int not null default 1 check (weight between 1 and 100),

  starts_at timestamptz,
  ends_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ad_placements_window check (starts_at is null or ends_at is null or ends_at > starts_at),

  -- Alt text arrives with the image, not with approval. Same rule as the hero (migration 73).
  constraint ad_placements_desktop_alt check (
    image_desktop_path is null
    or nullif(btrim(coalesce(image_desktop_alt->>'sq', '')), '') is not null
  ),
  constraint ad_placements_mobile_alt check (
    image_mobile_path is null
    or nullif(btrim(coalesce(image_mobile_alt->>'sq', '')), '') is not null
  ),

  /*
   * What approval requires. An approved placement with no creative is a reserved empty box on a
   * shop page, which the brief forbids outright.
   */
  constraint ad_placements_approvable check (
    status <> 'approved' or image_desktop_path is not null
  )
);

create index ad_placements_live_idx on ad_placements (weight desc, created_at)
  where status = 'approved';
create index ad_placements_merchant_idx on ad_placements (merchant_id)
  where merchant_id is not null;

alter table ad_placements enable row level security;

/*
 * No public select policy at all — the storefront reads through `list_live_placements`, which is
 * security definer. Targeting rules, weights, advertiser names and internal notes are commercial
 * information, and a shopper needs the creative rather than the contract behind it.
 */
create policy p_write on ad_placements for all
  using ((select has_any_role('{content_manager}')))
  with check ((select has_any_role('{content_manager}')));

create trigger set_updated_at before update on ad_placements
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Aggregate counters
-- -----------------------------------------------------------------------------

create table ad_placement_stats (
  placement_id uuid not null references ad_placements(id) on delete cascade,
  day date not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  primary key (placement_id, day)
);

alter table ad_placement_stats enable row level security;

-- Staff read; the two writers below are security definer, so no insert policy exists and none should.
create policy p_read on ad_placement_stats for select
  using ((select has_any_role('{content_manager,product_manager}')));

-- -----------------------------------------------------------------------------
-- The storefront's one read
-- -----------------------------------------------------------------------------

/**
 * Live placements for a listing page, most heavily weighted first.
 *
 * "Live" is approved **and** inside its window — the schedule is enforced here rather than left to
 * each caller, so an expired placement cannot reappear because somebody wrote a query without the
 * date clause. Expired rows stay in the table for billing; they simply stop being returned.
 *
 * Five is the cap from the brief. Enforced in SQL rather than trusted to the component, because the
 * number of dots a shopper is willing to look at is a product decision, not a rendering detail.
 */
create or replace function public.list_live_placements(
  p_category_slug text default null,
  p_brand_slug text default null
)
returns table (
  id uuid,
  headline jsonb,
  subhead jsonb,
  cta_label jsonb,
  destination_url text,
  open_in_new_tab boolean,
  image_desktop_path text,
  image_desktop_alt jsonb,
  image_mobile_path text,
  image_mobile_alt jsonb,
  is_paid boolean
)
language sql stable security definer set search_path = public, extensions
as $$
  select
    p.id, p.headline, p.subhead, p.cta_label, p.destination_url, p.open_in_new_tab,
    p.image_desktop_path, p.image_desktop_alt, p.image_mobile_path, p.image_mobile_alt, p.is_paid
  from ad_placements p
  where p.status = 'approved'
    and (p.starts_at is null or p.starts_at <= now())
    and (p.ends_at is null or p.ends_at > now())
    and p.image_desktop_path is not null
    -- An empty target array means every listing page; a populated one must contain this page.
    and (cardinality(p.target_category_slugs) = 0
         or (p_category_slug is not null and p_category_slug = any(p.target_category_slugs)))
    and (cardinality(p.target_brand_slugs) = 0
         or (p_brand_slug is not null and p_brand_slug = any(p.target_brand_slugs)))
  order by p.weight desc, p.created_at
  limit 5;
$$;

-- -----------------------------------------------------------------------------
-- Counters
-- -----------------------------------------------------------------------------

/**
 * One impression. Called from the browser when the slot actually enters the viewport.
 *
 * Increments a daily row rather than inserting an event, so the table cannot grow with traffic and
 * there is nothing in it that describes a person. Silent on failure: a counter is never worth an
 * error on a page a shopper is reading.
 *
 * It will only ever count what a real browser reports, and a determined caller could inflate it.
 * That is true of every impression counter that is not server-rendered, and the honest mitigation is
 * that these numbers are read by the person doing the billing rather than by the advertiser.
 */
create or replace function public.record_ad_impression(p_placement_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into ad_placement_stats (placement_id, day, impressions)
  values (p_placement_id, current_date, 1)
  on conflict (placement_id, day) do update
    set impressions = ad_placement_stats.impressions + 1;
exception when others then
  return;
end $$;

create or replace function public.record_ad_click(p_placement_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into ad_placement_stats (placement_id, day, clicks)
  values (p_placement_id, current_date, 1)
  on conflict (placement_id, day) do update
    set clicks = ad_placement_stats.clicks + 1;
exception when others then
  return;
end $$;

grant execute on function public.list_live_placements(text, text) to anon, authenticated;
grant execute on function public.record_ad_impression(uuid) to anon, authenticated;
grant execute on function public.record_ad_click(uuid) to anon, authenticated;

/**
 * The billing view: one row per placement with lifetime totals, and the dates it ran.
 *
 * `security_invoker`, so the reader's RLS applies rather than the view owner's — the same rule the
 * marketplace, referral and search reports follow.
 */
create view ad_placement_report with (security_invoker = true) as
select
  p.id,
  p.advertiser_name,
  p.status,
  p.is_paid,
  p.weight,
  p.starts_at,
  p.ends_at,
  coalesce(sum(s.impressions), 0)::bigint as impressions,
  coalesce(sum(s.clicks), 0)::bigint as clicks,
  round(100.0 * coalesce(sum(s.clicks), 0) / nullif(sum(s.impressions), 0), 2) as ctr_pct,
  min(s.day) as first_day,
  max(s.day) as last_day
from ad_placements p
left join ad_placement_stats s on s.placement_id = p.id
group by p.id;

comment on view ad_placement_report is
  'Lifetime impressions, clicks and CTR per sponsored placement. Aggregate only — no per-person data exists.';
