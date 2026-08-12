-- 84 · What is waiting for staff, in one row
--
-- The defect this fixes, stated as the owner found it (2026-08-12): a merchant files six proposals and
-- nothing anywhere says so. An admin has to *open* `/admin/merchants/proposals` to discover there is
-- work in it, which means the way you learn about pending work is to already suspect it exists.
--
-- Measured on production the day this was written, and the numbers are the argument:
--
--     product_proposals  status = 'pending'         6
--     merchant_offers    status = 'pending_review'  2
--     contact_messages   status = 'new'            82
--
-- Ninety items in queues, none of them visible from anywhere. The 82 unanswered messages had been
-- accumulating longest and were the queue nobody had thought to ask about — which is the point: a badge
-- has to cover every queue, not the one that prompted the complaint, or the next backlog just moves to
-- whichever surface was left out.
--
-- ── Why a view of scalars rather than a count per page ──
--
-- The admin layout renders on every navigation, so this is read constantly. Eleven separate PostgREST
-- count requests would be eleven round trips *per page view*; one view is one. It stays a view rather
-- than a function so PostgREST exposes it as a plain selectable resource and the SSR client can read it
-- with the anon key like any table.
--
-- ── security_invoker, deliberately ──
--
-- `security_invoker = on` means RLS on each underlying table applies to whoever asks. That is the whole
-- safety story here: this view names eleven operational tables, and a definer-rights view would hand
-- every one of their row counts to anybody who could reach it. With invoker rights a role that has no
-- policy on `contact_messages` counts zero of them, which is the correct answer to a question it is not
-- allowed to ask (CLAUDE.md §5 — RLS is the boundary, never worked around).
--
-- Capability filtering still happens in TypeScript on top of this, so a warehouse manager is not shown a
-- proposals badge. That filter is for tidiness; this is for security. They are not the same layer.
create or replace view public.v_admin_pending with (security_invoker = on) as
  select
    -- Marketplace. `merchant_offers` returns to 'pending_review' when a merchant edits an approved
    -- price (migration 20260810000300), so a price change appears here as new work automatically —
    -- it does not need its own counter.
    (select count(*) from public.merchants where status = 'pending')::int
      as merchant_applications,
    (select count(*) from public.product_proposals where status = 'pending')::int
      as proposals,
    (select count(*) from public.merchant_offers where status = 'pending_review')::int
      as offers,
    (select count(*) from public.merchant_payouts where status = 'pending')::int
      as payouts,
    (select count(*) from public.order_fulfilments where status = 'unassigned')::int
      as unassigned_fulfilments,

    -- Operations.
    (select count(*) from public.orders where status = 'pending')::int
      as orders_to_confirm,
    (select count(*) from public.contact_messages where status = 'new')::int
      as messages,

    -- Trust and content.
    (select count(*) from public.reviews where status = 'pending')::int
      as reviews,
    -- The only one of the eleven with a soft delete, so the only one that needs the guard. Counting
    -- deleted rows here would send compliance to a queue page that renders fewer items than the badge
    -- promised, and a badge that overstates is worse than none: it teaches staff to ignore it.
    (select count(*) from public.products where status = 'pending_review' and deleted_at is null)::int
      as compliance,
    (select count(*) from public.ad_placements where status = 'pending_review')::int
      as placements,
    (select count(*) from public.referral_links where status = 'pending')::int
      as referrals;

comment on view public.v_admin_pending is
  'One row of counts: everything across the panel that is waiting for a staff decision. Read by the '
  'admin layout on every render to badge the sidebar, and by the dashboard for the "Needs attention" '
  'list. security_invoker so RLS decides what each role can count. docs/06 §1, docs/13 §AK.';

grant select on public.v_admin_pending to authenticated, service_role;

/*
 * Partial indexes on the queue predicates.
 *
 * Not premature: this view runs on every admin page load, and `orders` and `contact_messages` are the
 * two tables here that grow without bound. A partial index is the right shape because it indexes only
 * the rows in the queue — a confirmed order leaves the index entirely, so `orders_pending_idx` stays
 * roughly the size of the backlog forever rather than the size of the order book.
 *
 * `reviews` already has exactly this (`reviews_moderation_idx`), and `referral_links_expiry_idx` leads
 * with status, so neither is repeated. The rest are covered by composite indexes that lead with
 * `merchant_id`, which a global count cannot use.
 */
create index if not exists orders_pending_idx
  on public.orders (created_at) where status = 'pending';

create index if not exists contact_messages_new_idx
  on public.contact_messages (created_at) where status = 'new';

create index if not exists product_proposals_pending_idx
  on public.product_proposals (created_at) where status = 'pending';

create index if not exists merchant_offers_pending_idx
  on public.merchant_offers (created_at) where status = 'pending_review';

create index if not exists merchants_pending_idx
  on public.merchants (created_at) where status = 'pending';

create index if not exists products_compliance_idx
  on public.products (updated_at) where status = 'pending_review' and deleted_at is null;
