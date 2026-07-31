-- =============================================================================
-- 04 · Inventory and fulfilment configuration
-- Source: docs/03 §5, with the correction in docs/13 §A7.
-- =============================================================================

create table warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_default_warehouse on warehouses (is_default) where is_default;

create table inventory_levels (
  variant_id uuid references product_variants(id) on delete cascade,
  warehouse_id uuid references warehouses(id) on delete cascade,
  on_hand int not null default 0 check (on_hand >= 0),
  low_stock_threshold int not null default 5,
  updated_at timestamptz not null default now(),
  primary key (variant_id, warehouse_id)
);

/*
 * Append-only ledger. docs/07 §11 and docs/09 §1 require `on_hand` to equal the sum of
 * movements for a variant, and docs/13 §A7 notes that nothing enforced it: any opening
 * balance written straight into `inventory_levels` broke the invariant on day one.
 *
 * The rule is now explicit and testable — every change to `on_hand` is paired with a
 * movement row, including seed data, which writes opening balances as `received`.
 */
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants(id),
  warehouse_id uuid not null references warehouses(id),
  type stock_movement_type not null,
  quantity int not null,                     -- signed: received +, sale −
  batch_number text,
  expiry_date date,
  reference_type text,                       -- e.g. 'order'
  reference_id uuid,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint stock_movements_quantity_nonzero check (quantity <> 0)
);

/**
 * Applies a movement and moves `on_hand` in the same statement, so the two can never
 * diverge. This is the only sanctioned way to change stock outside the checkout RPC.
 */
create or replace function public.apply_stock_movement(
  p_variant_id uuid,
  p_warehouse_id uuid,
  p_type stock_movement_type,
  p_quantity int,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_batch_number text default null,
  p_expiry_date date default null,
  p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_on_hand int;
begin
  if not (is_service_role() or has_any_role(array['warehouse_manager','product_manager']::user_role[])) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  insert into inventory_levels (variant_id, warehouse_id, on_hand)
  values (p_variant_id, p_warehouse_id, 0)
  on conflict (variant_id, warehouse_id) do nothing;

  update inventory_levels
     set on_hand = on_hand + p_quantity, updated_at = now()
   where variant_id = p_variant_id and warehouse_id = p_warehouse_id
  returning on_hand into v_on_hand;

  -- The CHECK constraint would also catch this, but a named error is actionable in the UI.
  if v_on_hand < 0 then
    raise exception 'INSUFFICIENT_STOCK' using errcode = '23514';
  end if;

  insert into stock_movements (
    variant_id, warehouse_id, type, quantity,
    batch_number, expiry_date, reference_type, reference_id, note, created_by
  ) values (
    p_variant_id, p_warehouse_id, p_type, p_quantity,
    p_batch_number, p_expiry_date, p_reference_type, p_reference_id, p_note, auth.uid()
  );
end $$;

revoke all on function public.apply_stock_movement(uuid, uuid, stock_movement_type, int, text, uuid, text, date, text) from public, anon;
grant execute on function public.apply_stock_movement(uuid, uuid, stock_movement_type, int, text, uuid, text, date, text) to authenticated, service_role;

create table shipping_methods (
  id uuid primary key default gen_random_uuid(),
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  price_cents int not null default 0 check (price_cents >= 0),
  free_over_cents int check (free_over_cents >= 0),
  countries text[] not null default '{XK}',
  min_days int not null default 1,
  max_days int not null default 3,
  is_active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_days_ordered check (max_days >= min_days)
);
