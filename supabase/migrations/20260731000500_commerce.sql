-- =============================================================================
-- 05 · Commerce — carts, coupons, orders, payments, refunds, shipments
-- Source: docs/03 §6, with the corrections in docs/13 §A3, §B1, §D2.
-- =============================================================================

create table carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  anon_token uuid unique default gen_random_uuid(),   -- httpOnly cookie for guests
  status cart_status not null default 'active',
  currency char(3) not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_active_cart_per_user
  on carts (user_id) where status = 'active' and user_id is not null;

create table cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references carts(id) on delete cascade,
  variant_id uuid not null references product_variants(id) on delete cascade,
  quantity int not null check (quantity between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, variant_id)
);

create table coupons (
  id uuid primary key default gen_random_uuid(),
  code extensions.citext not null unique,
  type discount_type not null,
  value int not null default 0,              -- percentage: whole % · fixed: cents
  min_subtotal_cents int,
  max_uses int,
  max_uses_per_user int,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  /*
   * docs/13 §A3 — system coupons (`SUB-10`, `LOY-XXXXXX`) are hidden from /offers and the
   * admin list, but they must remain ACTIVE: the checkout RPC looks coupons up with
   * `… and is_active`, so the spec's "hidden is_active" would have made the subscription
   * discount permanently unappliable. Hidden is a listing concern, not a state concern.
   */
  is_system boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupon_percentage_range
    check (type <> 'percentage' or value between 0 and 100),
  constraint coupon_window_ordered
    check (starts_at is null or ends_at is null or ends_at >= starts_at)
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default generate_order_number(),
  /*
   * docs/13 §B1 — the checkout success page renders order contents and, for guests, must
   * read them with the service client. Keyed on the order number alone that is an
   * enumeration hole: name, address, phone, items and totals for every order.
   *
   * `placeOrder` sets this token in a 30-minute httpOnly cookie and the success route
   * requires it; without it the route redirects to /order-lookup (number + email).
   */
  access_token text not null default generate_access_token(),
  user_id uuid references profiles(id) on delete set null,
  subscription_id uuid,                      -- FK added once subscriptions exist
  email extensions.citext not null,
  phone text not null,
  status order_status not null default 'pending',
  payment_status payment_status not null default 'pending',
  currency char(3) not null default 'EUR',
  subtotal_cents int not null,
  discount_cents int not null default 0,
  shipping_cents int not null default 0,
  tax_cents int not null default 0,          -- informational; pricing is VAT-inclusive
  total_cents int not null,
  coupon_id uuid references coupons(id),
  coupon_code text,
  shipping_method jsonb,
  shipping_address jsonb not null,
  billing_address jsonb not null,
  customer_note text,
  admin_note text,
  locale text not null default 'sq' check (locale in ('sq','en')),
  source text not null default 'web',
  placed_at timestamptz not null default now(),
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  variant_id uuid references product_variants(id) on delete set null,
  name_snapshot text not null,
  sku text not null,
  image_path text,
  quantity int not null check (quantity > 0),
  unit_price_cents int not null,
  total_cents int not null,
  created_at timestamptz not null default now()
);

create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  -- created | status_changed | note | email_sent | payment_update | refund
  type text not null,
  message text,
  data jsonb not null default '{}'::jsonb,
  /** docs/05 §14 — customer-facing timeline shows only rows where this is true. */
  is_customer_visible boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  provider payment_provider not null,
  status payment_status not null default 'pending',
  amount_cents int not null,
  currency char(3) not null default 'EUR',
  provider_ref text,
  error text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/*
 * docs/13 §D2 — docs/07 §6.3 requires webhook handling to be idempotent "via a unique
 * index on payments.provider_ref", but the schema never created it. Without this a
 * retried or replayed bank callback marks the same payment paid twice.
 */
create unique index payments_provider_ref_key
  on payments (provider_ref) where provider_ref is not null;

create table refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  payment_id uuid references payments(id),
  amount_cents int not null check (amount_cents > 0),
  reason text not null,
  restock boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  carrier text,
  tracking_number text,
  tracking_url text,
  status text not null default 'pending',
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references coupons(id),
  user_id uuid references profiles(id),
  order_id uuid not null references orders(id) on delete cascade,
  created_at timestamptz not null default now()
);
