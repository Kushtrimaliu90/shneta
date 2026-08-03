-- =============================================================================
-- 26 · M12 · Marketplace — merchants, offers, fulfilments, money
-- Source: docs/16 §2, §3.
-- =============================================================================

/*
 * BioCode becomes a hybrid marketplace: it sells its own stock and approved third parties sell
 * theirs on the same storefront.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The one decision everything else follows from: canonical products, merchant offers.
 *
 * Merchants do not get product pages. `products` stays the admin-owned catalogue — one page, one
 * PDP, one review pool, one SEO URL — and a merchant adds a row to `merchant_offers` saying "I
 * have variant V at price P with stock S".
 *
 * That is not a tidiness preference. "Route this order to a merchant who has the same stock" is
 * only a computable question when BioCode and both merchants point at *one* variant id. Let
 * merchants create their own listings and the same tub of vitamin D becomes three products, three
 * review pools, three URLs competing in search, and no way to ask who else has it.
 *
 * BioCode's own stock stays in `inventory_levels` and is **not** an offer row. First-party is
 * privileged by the shape of the schema rather than by a flag somebody can forget to check.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Isolation is the security core (docs/16 §3), and it is enforced in three layers:
 *
 *   1. RLS on every table, filtered through `current_merchant_ids()`.
 *   2. Privileged columns unreachable — a merchant cannot write `status`, `commission_pct`, or any
 *      ledger row, because those policies do not exist rather than because the UI hides them.
 *   3. One read path to order data: `merchant_fulfilment_view()`. Merchants are never granted
 *      select on `orders` at all, so there is no join for a future feature to reach through.
 */

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type merchant_status   as enum ('pending', 'approved', 'suspended', 'rejected');
create type offer_status      as enum ('draft', 'pending_review', 'approved', 'rejected', 'paused');
create type payout_status     as enum ('pending', 'approved', 'paid', 'on_hold');

/*
 * The merchant-side lane. `delivered` is here but is **not** a transition a merchant may make —
 * courier confirmation is BioCode's (docs/16 §7). The enum holds every state a fulfilment can be
 * in; who may move it there is a policy question, answered below.
 */
create type fulfilment_status as enum (
  'unassigned', 'assigned', 'accepted', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'
);

/*
 * `partially_shipped` (docs/16 §7).
 *
 * Order status becomes derived from its fulfilments, and a mixed cart where BioCode has shipped
 * its half and a merchant has not is a real state the old enum could not express — it would have
 * had to lie in one direction or the other.
 */
alter type order_status add value if not exists 'partially_shipped' after 'processing';

-- -----------------------------------------------------------------------------
-- Merchants
-- -----------------------------------------------------------------------------

create table merchants (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext unique not null,
  legal_name text not null,
  display_name text not null,

  -- ARBK is Kosovo's business registry; `business_no` is that number.
  business_no text not null,
  vat_no text,
  iban text,
  bank_name text,

  contact_name text not null,
  contact_email extensions.citext not null,
  contact_phone text not null,
  address jsonb not null,

  status merchant_status not null default 'pending',

  /*
   * Numeric, not int-cents, because a percentage is not money — and `numeric(5,2)` keeps 15.00 and
   * 12.50 exact where a float would eventually produce a commission ending in 0.9999.
   */
  commission_pct numeric(5,2) not null default 15.00
    check (commission_pct >= 0 and commission_pct <= 100),

  /** False means the merchant drops stock at the BioCode warehouse and BioCode ships it. */
  ships_own boolean not null default true,

  /*
   * True only for the variant in docs/16 §8 where the merchant's own courier collects the cash.
   * It inverts the sign of the ledger entry, so it is a column rather than an assumption.
   */
  collects_cash boolean not null default false,

  rating_avg numeric(3,2) not null default 0,
  rating_count int not null default 0,

  approved_by uuid references profiles(id),
  approved_at timestamptz,
  rejection_note text,
  suspended_reason text,

  /** Which version of the marketplace terms was accepted, and when (docs/16 §10). */
  terms_version text,
  terms_accepted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger merchants_updated_at
  before update on merchants
  for each row execute function public.set_updated_at();

/** Staff of a merchant. A person may in principle belong to more than one. */
create table merchant_users (
  merchant_id uuid not null references merchants(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (merchant_id, user_id)
);

create index merchant_users_user on merchant_users (user_id);

/** KYB uploads. `storage_path` points into a **private** bucket; nothing here is public. */
create table merchant_documents (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  kind text not null check (
    kind in ('business_registration', 'vat_certificate', 'id_document', 'import_licence', 'other')
  ),
  storage_path text not null,
  uploaded_at timestamptz not null default now(),
  verified boolean not null default false,
  verified_by uuid references profiles(id)
);

create index merchant_documents_merchant on merchant_documents (merchant_id);

-- -----------------------------------------------------------------------------
-- Offers
-- -----------------------------------------------------------------------------

create table merchant_offers (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  variant_id uuid not null references product_variants(id) on delete cascade,
  merchant_sku text,
  price_cents int not null check (price_cents > 0),
  stock_on_hand int not null default 0 check (stock_on_hand >= 0),
  low_stock_threshold int not null default 3,
  handling_days int not null default 1 check (handling_days >= 0 and handling_days <= 30),
  status offer_status not null default 'draft',
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  rejection_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * One offer per merchant per variant. Two would make the buy box ambiguous and give a merchant a
   * way to occupy both the cheapest and the second-cheapest slot.
   */
  unique (merchant_id, variant_id)
);

create trigger merchant_offers_updated_at
  before update on merchant_offers
  for each row execute function public.set_updated_at();

/** The buy box reads this one hundreds of times a day; the partial index keeps it small. */
create index merchant_offers_live on merchant_offers (variant_id)
  where status = 'approved' and stock_on_hand > 0;
create index merchant_offers_by_merchant on merchant_offers (merchant_id, status);

/** A merchant asking for a catalogue product that does not exist yet (docs/16 §4). */
create table product_proposals (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  /** name, brand, form, ingredients, images, barcode — shaped by the portal form, not by SQL. */
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'needs_info')),
  created_product_id uuid references products(id),
  reviewer_note text,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger product_proposals_updated_at
  before update on product_proposals
  for each row execute function public.set_updated_at();

create index product_proposals_merchant on product_proposals (merchant_id, status);

-- -----------------------------------------------------------------------------
-- Fulfilments — an order splits into one per fulfiller
-- -----------------------------------------------------------------------------

create table order_fulfilments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  fulfiller_kind text not null check (fulfiller_kind in ('biocode', 'merchant')),
  merchant_id uuid references merchants(id),
  status fulfilment_status not null default 'unassigned',

  items_subtotal_cents int not null default 0,
  commission_cents int not null default 0,
  merchant_due_cents int not null default 0,

  assigned_by uuid references profiles(id),
  assigned_at timestamptz,
  accepted_at timestamptz,
  packed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,

  carrier text,
  tracking_code text,
  cancel_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * A merchant fulfilment has a merchant and a BioCode one does not — both directions.
   * `=` between two booleans is the compact way to say "exactly one of these shapes", and it is
   * what stops a BioCode fulfilment quietly carrying a merchant id that a later query would
   * believe.
   */
  constraint fulfilment_merchant_iff_merchant_kind
    check ((fulfiller_kind = 'merchant') = (merchant_id is not null))
);

create trigger order_fulfilments_updated_at
  before update on order_fulfilments
  for each row execute function public.set_updated_at();

create index order_fulfilments_order on order_fulfilments (order_id);
create index order_fulfilments_merchant on order_fulfilments (merchant_id, status);
/** `/admin/routing` is a query for exactly this, and it is the daily-driver screen. */
create index order_fulfilments_unassigned on order_fulfilments (created_at)
  where status = 'unassigned';

/*
 * Which fulfilment a line belongs to, and which offer priced it.
 *
 * Nullable, and permanently so: every order placed before this migration has neither, and
 * back-filling them would invent a fulfilment that never happened. Readers treat null as
 * "pre-marketplace, BioCode fulfilled it", which is true.
 */
alter table order_items add column if not exists fulfilment_id uuid references order_fulfilments(id);
alter table order_items add column if not exists merchant_offer_id uuid references merchant_offers(id);

create index order_items_fulfilment on order_items (fulfilment_id);

-- -----------------------------------------------------------------------------
-- Money
-- -----------------------------------------------------------------------------

/*
 * Append-only, signed, and the balance is just the sum.
 *
 * Signed rather than a pair of debit/credit columns because COD runs in both directions: normally
 * BioCode's courier collects the cash and owes the merchant its net, but a merchant with its own
 * courier collects the cash and owes BioCode the commission. One signed column expresses both
 * without a second table or a "direction" flag nobody would remember to read.
 *
 * `+` is owed **to** the merchant, `−` is owed **by** the merchant. There is no update or delete
 * policy anywhere: a correction is another row, so the history stays reconstructible — the same
 * discipline as `stock_movements` and `loyalty_transactions` (docs/13 §A7).
 */
create table merchant_ledger (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id),
  fulfilment_id uuid references order_fulfilments(id),
  kind text not null check (
    kind in ('sale', 'commission', 'cod_collected', 'refund', 'adjustment', 'payout')
  ),
  amount_cents int not null,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index merchant_ledger_merchant on merchant_ledger (merchant_id, created_at desc);
create index merchant_ledger_fulfilment on merchant_ledger (fulfilment_id);

create table merchant_payouts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id),
  period_start date not null,
  period_end date not null,
  gross_cents int not null,
  commission_cents int not null,
  net_cents int not null,
  status payout_status not null default 'pending',
  paid_at timestamptz,
  reference text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (period_end >= period_start)
);

create trigger merchant_payouts_updated_at
  before update on merchant_payouts
  for each row execute function public.set_updated_at();

create index merchant_payouts_merchant on merchant_payouts (merchant_id, period_end desc);

-- -----------------------------------------------------------------------------
-- The isolation helper
-- -----------------------------------------------------------------------------

/*
 * Which merchants the current user belongs to.
 *
 * Security definer, because a policy on `merchant_offers` that queried `merchant_users` directly
 * would need a select policy on `merchant_users` to evaluate — and that policy would itself need
 * to know which merchants the user belongs to. The recursion is why this is a function.
 *
 * `stable` so the planner hoists it to an InitPlan instead of re-running it per row, the same
 * reason every policy in this codebase wraps `auth.uid()` in a subselect (docs/13 §D7).
 *
 * Returns an empty array for anonymous users, customers and staff. **Every merchant-facing policy
 * filters on it**, so "not a merchant" produces zero rows rather than an error — which is the
 * behaviour that makes a hostile request indistinguishable from an empty account.
 */
create or replace function public.current_merchant_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(mu.merchant_id), '{}'::uuid[])
  from merchant_users mu
  join merchants m on m.id = mu.merchant_id
  where mu.user_id = auth.uid()
    -- A suspended or rejected merchant keeps its rows and loses its access.
    and m.status in ('pending', 'approved');
$$;

comment on function public.current_merchant_ids is
  'Merchant ids the caller belongs to. Empty for everyone who is not a merchant. docs/16 §3.';

/** True when the caller is a merchant at all — for the `is_staff`-shaped checks. */
create or replace function public.is_merchant() returns boolean
language sql stable security definer set search_path = public as $$
  select cardinality(current_merchant_ids()) > 0;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table merchants           enable row level security;
alter table merchant_users      enable row level security;
alter table merchant_documents  enable row level security;
alter table merchant_offers     enable row level security;
alter table product_proposals   enable row level security;
alter table order_fulfilments   enable row level security;
alter table merchant_ledger     enable row level security;
alter table merchant_payouts    enable row level security;

/*
 * `merchants` — a merchant reads its own row; staff read all; only admin sets status or commission.
 *
 * The update policy is split deliberately. A merchant may maintain its own contact and bank
 * details, so a `with check` that merely confirmed ownership would also let it write
 * `status = 'approved'` and `commission_pct = 0`. Postgres has no per-column policy, so the
 * privileged columns are frozen by a trigger below and the policy only proves ownership.
 */
create policy p_own_read on merchants for select
  using (id = any (current_merchant_ids()));
create policy p_staff_read on merchants for select
  using ((select is_staff()));
create policy p_admin_write on merchants for all
  using ((select is_admin())) with check ((select is_admin()));
create policy p_own_update on merchants for update
  using (id = any (current_merchant_ids()))
  with check (id = any (current_merchant_ids()));

/*
 * The columns a merchant must never move on its own row.
 *
 * A trigger rather than a policy because RLS is row-level: `with check` can say *which rows* may be
 * written, never *which columns*. Without this, `p_own_update` is a self-approval button.
 *
 * A bank change is allowed and **notified**: `iban` is the field an attacker who took over a
 * merchant account would change, so it writes an audit row every time.
 */
create or replace function public.guard_merchant_self_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_service_role() or has_any_role(array['admin']::user_role[]) then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.commission_pct is distinct from old.commission_pct
     or new.ships_own is distinct from old.ships_own
     or new.collects_cash is distinct from old.collects_cash
     or new.slug is distinct from old.slug
     or new.business_no is distinct from old.business_no
     or new.legal_name is distinct from old.legal_name
     or new.rating_avg is distinct from old.rating_avg
     or new.rating_count is distinct from old.rating_count
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at
  then
    raise exception 'MERCHANT_FIELD_FORBIDDEN' using errcode = '42501';
  end if;

  if new.iban is distinct from old.iban or new.bank_name is distinct from old.bank_name then
    insert into audit_logs (actor_id, action, entity, entity_id, after)
    values (
      auth.uid(), 'merchant.bank_changed', 'merchant', new.id::text,
      jsonb_build_object('bank_name', new.bank_name, 'iban_last4', right(coalesce(new.iban, ''), 4))
    );
  end if;

  return new;
end $$;

create trigger merchants_self_update_guard
  before update on merchants
  for each row execute function public.guard_merchant_self_update();

/** `merchant_users` — see your own membership. Only admin and the service role write it. */
create policy p_own_read on merchant_users for select
  using (merchant_id = any (current_merchant_ids()));
create policy p_staff_read on merchant_users for select
  using ((select is_staff()));
create policy p_admin_write on merchant_users for all
  using ((select is_admin())) with check ((select is_admin()));

/** Documents — own reads and own uploads; verification is staff-only. */
create policy p_own_read on merchant_documents for select
  using (merchant_id = any (current_merchant_ids()));
create policy p_own_insert on merchant_documents for insert
  with check (merchant_id = any (current_merchant_ids()));
create policy p_staff_read on merchant_documents for select
  using ((select is_staff()));
create policy p_admin_write on merchant_documents for all
  using ((select is_admin())) with check ((select is_admin()));

/*
 * Offers — a merchant manages its own, and cannot approve them.
 *
 * `status` is frozen for merchants by the trigger below in the same way and for the same reason as
 * `merchants.status`: without it, `p_own_write` is an approval button.
 */
create policy p_own_read on merchant_offers for select
  using (merchant_id = any (current_merchant_ids()));
create policy p_own_insert on merchant_offers for insert
  with check (merchant_id = any (current_merchant_ids()));
create policy p_own_update on merchant_offers for update
  using (merchant_id = any (current_merchant_ids()))
  with check (merchant_id = any (current_merchant_ids()));
create policy p_own_delete on merchant_offers for delete
  using (merchant_id = any (current_merchant_ids()) and status in ('draft', 'rejected'));
create policy p_staff_read on merchant_offers for select
  using ((select is_staff()));
create policy p_pm_write on merchant_offers for all
  using ((select has_any_role('{product_manager,admin}')))
  with check ((select has_any_role('{product_manager,admin}')));

create or replace function public.guard_merchant_offer_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_service_role() or has_any_role(array['product_manager', 'admin']::user_role[]) then
    return new;
  end if;

  /*
   * A merchant may move an offer between its own states — `draft`, `pending_review` and, once
   * approved, `paused` and back. It may not reach `approved` or `rejected`, which are the
   * reviewer's words.
   */
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'pending_review') then
      raise exception 'OFFER_STATUS_FORBIDDEN' using errcode = '42501';
    end if;
    if new.approved_by is not null or new.approved_at is not null then
      raise exception 'OFFER_APPROVAL_FORBIDDEN' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status in ('approved', 'rejected') then
      raise exception 'OFFER_STATUS_FORBIDDEN' using errcode = '42501';
    end if;
    -- Leaving `approved` is allowed only towards `paused`; anything else is a re-review.
    if old.status = 'approved' and new.status not in ('paused', 'pending_review') then
      raise exception 'OFFER_STATUS_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  if new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at
     or new.rejection_note is distinct from old.rejection_note
     or new.merchant_id is distinct from old.merchant_id
  then
    raise exception 'OFFER_APPROVAL_FORBIDDEN' using errcode = '42501';
  end if;

  return new;
end $$;

create trigger merchant_offers_write_guard
  before insert or update on merchant_offers
  for each row execute function public.guard_merchant_offer_write();

/** Proposals — own reads and own submissions; the review columns are staff-only. */
create policy p_own_read on product_proposals for select
  using (merchant_id = any (current_merchant_ids()));
create policy p_own_insert on product_proposals for insert
  with check (merchant_id = any (current_merchant_ids()) and status = 'pending');
create policy p_own_update on product_proposals for update
  using (merchant_id = any (current_merchant_ids()) and status = 'needs_info')
  with check (merchant_id = any (current_merchant_ids()));
create policy p_staff_read on product_proposals for select
  using ((select is_staff()));
create policy p_pm_write on product_proposals for all
  using ((select has_any_role('{product_manager,compliance_manager,admin}')))
  with check ((select has_any_role('{product_manager,compliance_manager,admin}')));

/*
 * Fulfilments — a merchant sees only its own, and may move only its own lane.
 *
 * Note what is **absent**: no policy grants a merchant select on `orders`. A fulfilment row carries
 * `order_id`, so a merchant can learn that an order exists, and can read nothing about it. The
 * customer's email, the totals, the coupon, the other fulfilments and BioCode's stock are all
 * behind a table it cannot select from — not behind a column list somebody has to maintain.
 */
create policy p_own_read on order_fulfilments for select
  using (merchant_id = any (current_merchant_ids()));
create policy p_own_update on order_fulfilments for update
  using (
    merchant_id = any (current_merchant_ids())
    and status in ('assigned', 'accepted', 'packed')
  )
  with check (merchant_id = any (current_merchant_ids()));
create policy p_staff_read on order_fulfilments for select
  using ((select is_staff()));
create policy p_staff_write on order_fulfilments for all
  using ((select has_any_role('{support,warehouse_manager,admin}')))
  with check ((select has_any_role('{support,warehouse_manager,admin}')));

/*
 * The merchant's lane, enforced.
 *
 * `assigned → accepted → packed → shipped`, plus declining before acceptance. `delivered` is the
 * courier's word and BioCode's to record (docs/16 §7): a merchant that could mark its own parcels
 * delivered could trigger its own payout.
 */
create or replace function public.guard_fulfilment_transition() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  allowed text[];
begin
  if is_service_role()
     or has_any_role(array['support', 'warehouse_manager', 'admin']::user_role[]) then
    return new;
  end if;

  if new.status is distinct from old.status then
    allowed := case old.status::text
      -- Declining lands on `cancelled`; the routing action returns it to the queue.
      when 'assigned' then array['accepted', 'cancelled']
      when 'accepted' then array['packed', 'cancelled']
      when 'packed'   then array['shipped']
      else array[]::text[]
    end;

    if not (new.status::text = any (allowed)) then
      raise exception 'FULFILMENT_TRANSITION_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  -- The money and the assignment are not the merchant's to touch.
  if new.items_subtotal_cents is distinct from old.items_subtotal_cents
     or new.commission_cents is distinct from old.commission_cents
     or new.merchant_due_cents is distinct from old.merchant_due_cents
     or new.merchant_id is distinct from old.merchant_id
     or new.order_id is distinct from old.order_id
     or new.fulfiller_kind is distinct from old.fulfiller_kind
     or new.delivered_at is distinct from old.delivered_at
  then
    raise exception 'FULFILMENT_FIELD_FORBIDDEN' using errcode = '42501';
  end if;

  return new;
end $$;

create trigger order_fulfilments_transition_guard
  before update on order_fulfilments
  for each row execute function public.guard_fulfilment_transition();

/*
 * Order items — readable only through a fulfilment the merchant owns.
 *
 * This is an **additional** policy on a table that already has customer and staff policies, and
 * policies are permissive: a merchant sees its own lines and nothing widens for anyone else.
 */
create policy p_merchant_read on order_items for select
  using (
    fulfilment_id is not null
    and exists (
      select 1 from order_fulfilments f
      where f.id = order_items.fulfilment_id
        and f.merchant_id = any (current_merchant_ids())
    )
  );

/*
 * Ledger and payouts — read your own, write nothing.
 *
 * There is no insert, update or delete policy for a merchant on either table, and that is the
 * whole design: every ledger row is written by a security-definer RPC or the service role, so the
 * balance is a consequence of what happened rather than of what a merchant claimed happened.
 */
create policy p_own_read on merchant_ledger for select
  using (merchant_id = any (current_merchant_ids()));
create policy p_staff_read on merchant_ledger for select
  using ((select is_staff()));
create policy p_admin_write on merchant_ledger for all
  using ((select is_admin())) with check ((select is_admin()));

create policy p_own_read on merchant_payouts for select
  using (merchant_id = any (current_merchant_ids()));
create policy p_staff_read on merchant_payouts for select
  using ((select is_staff()));
create policy p_admin_write on merchant_payouts for all
  using ((select is_admin())) with check ((select is_admin()));

-- -----------------------------------------------------------------------------
-- The one read path into order data (docs/16 §3)
-- -----------------------------------------------------------------------------

/*
 * Everything a merchant needs to pack a parcel, and nothing else.
 *
 * Security definer, so it can read `orders` — which the caller cannot. It returns a fixed jsonb
 * shape rather than a row from a view, because a view would grow columns as `orders` does and a
 * `select *` in a later feature would quietly widen what merchants can see.
 *
 * **The address and phone are withheld until the fulfilment is assigned.** Before that the
 * merchant is a candidate, not a fulfiller, and a candidate has no reason to hold a customer's
 * address — the routing screen shows several candidates per fulfilment, and only one of them will
 * ever ship it.
 *
 * `cod_amount` is this fulfilment's subtotal, never the order total. A merchant packing two of
 * five lines must not learn what the customer paid altogether.
 */
create or replace function public.merchant_fulfilment_view(p_fulfilment_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f record;
  o record;
  result jsonb;
  is_assigned boolean;
begin
  select * into f
  from order_fulfilments
  where id = p_fulfilment_id
    and merchant_id = any (current_merchant_ids());

  -- Null rather than an exception: a merchant probing another's id learns nothing from silence.
  if f is null then
    return null;
  end if;

  select * into o from orders where id = f.order_id;
  if o is null then
    return null;
  end if;

  is_assigned := f.status <> 'unassigned';

  select jsonb_build_object(
    'fulfilment', jsonb_build_object(
      'id', f.id,
      'status', f.status,
      'assigned_at', f.assigned_at,
      'accepted_at', f.accepted_at,
      'packed_at', f.packed_at,
      'shipped_at', f.shipped_at,
      'carrier', f.carrier,
      'tracking_code', f.tracking_code,
      'items_subtotal_cents', f.items_subtotal_cents,
      'merchant_due_cents', f.merchant_due_cents
    ),
    /*
     * The order number, and deliberately nothing else from `orders`. A merchant needs a reference
     * both sides can say out loud on the phone to BioCode support; it does not need the email, the
     * totals, the coupon or the customer's account.
     */
    'order_number', o.order_number,
    'placed_at', o.placed_at,
    'delivery_method', o.shipping_method,
    'items', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'product_name', oi.product_name,
          'variant_name', oi.variant_name,
          'sku', oi.sku,
          'quantity', oi.quantity,
          'unit_price_cents', oi.unit_price_cents
        ) order by oi.product_name)
        from order_items oi
        where oi.fulfilment_id = f.id
      ),
      '[]'::jsonb
    ),
    'ship_to', case
      when is_assigned then jsonb_build_object(
        'name', o.shipping_address->>'full_name',
        'phone', o.phone,
        'address', o.shipping_address - 'email'
      )
      else null
    end,
    'cod_amount_cents', case
      when o.payment_provider = 'cod' then f.items_subtotal_cents
      else 0
    end
  ) into result;

  return result;
end $$;

comment on function public.merchant_fulfilment_view is
  'The only read path from the merchant portal into order data. Address released once assigned. docs/16 §3.';

revoke all on function public.merchant_fulfilment_view(uuid) from public;
grant execute on function public.merchant_fulfilment_view(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------

insert into settings (key, value) values (
  'marketplace',
  jsonb_build_object(
    'enabled', true,
    'default_commission_pct', 15,
    /*
     * Manual routing is the default and the manual path is built first (docs/16 §6). Automation
     * that assigns a customer's order to a supplier is not something to switch on before somebody
     * has watched the screen do it by hand for a while.
     */
    'auto_route', false,
    'auto_accept_hours', 24,
    'payout_cycle', 'biweekly',
    'merchant_max_handling_days', 3,
    'price_change_review', false,
    /*
     * docs/16 §6 — flagged as a business decision and defaulted to absorbed. BioCode charges the
     * customer one shipping fee and keeps the cost; deducting a per-fulfilment rate from the
     * merchant's due is the alternative and needs a number nobody has given yet.
     */
    'shipping_cost_absorbed', true,
    'shipping_deduction_cents', 0
  )
)
on conflict (key) do nothing;
