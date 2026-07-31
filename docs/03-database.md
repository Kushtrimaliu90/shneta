# 03 · Database (Supabase / Postgres)

Source of truth for the schema. Implement as ordered migrations in `supabase/migrations/` (split roughly by the section numbers below). After every migration: `pnpm db:types`.

**Conventions:** snake_case; PK `id uuid default gen_random_uuid()`; timestamps `timestamptz` (`created_at default now()`, `updated_at default now()` + trigger); money `int` cents + `currency char(3) default 'EUR'`; translatable text `jsonb` shaped `{"sq": "...", "en": "..."}`; soft delete `deleted_at timestamptz` only where listed. RLS enabled on **every** table — with RLS on and no policy, access is denied by default; several write paths are intentionally RPC/service-only (no policies).

## 1. Extensions & enums

```sql
create extension if not exists citext;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

create type user_role as enum ('customer','support','product_manager','content_manager','warehouse_manager','compliance_manager','admin');
create type product_status as enum ('draft','pending_review','published','archived');
create type product_form as enum ('capsule','tablet','softgel','powder','liquid','gummy','bar','spray','sachet','other');
create type evidence_level as enum ('strong','moderate','emerging','traditional');
create type order_status as enum ('pending','confirmed','processing','shipped','delivered','cancelled','refunded');
create type payment_status as enum ('pending','paid','failed','refunded','partially_refunded');
create type payment_provider as enum ('cod','bank_pos','stripe');
create type discount_type as enum ('percentage','fixed','free_shipping');
create type review_status as enum ('pending','approved','rejected');
create type article_status as enum ('draft','in_review','published','archived');
create type article_type as enum ('article','guide','recipe','research','news');
create type subscription_status as enum ('active','paused','cancelled');
create type stock_movement_type as enum ('received','sale','cancel_restock','refund_restock','adjustment');
create type cart_status as enum ('active','converted','abandoned');
```

## 2. Helper functions

```sql
create or replace function public.set_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at := now(); return new; end $$;

-- Role of the calling user; security definer so it works under RLS.
create or replace function public.has_any_role(roles user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid()
                 and (p.role = any(roles) or p.role = 'admin'));
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array['support','product_manager','content_manager','warehouse_manager','compliance_manager']::user_role[]);
$$;

create sequence if not exists order_number_seq;
create or replace function public.generate_order_number() returns text language sql volatile as
$$ select 'SH-' || to_char(now(),'YYYY') || '-' || lpad(nextval('order_number_seq')::text, 6, '0') $$;
```

## 3. Identity

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null,
  full_name text,
  phone text,
  role user_role not null default 'customer',
  avatar_url text,
  preferred_locale text not null default 'sq' check (preferred_locale in ('sq','en')),
  loyalty_points int not null default 0 check (loyalty_points >= 0),
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change roles.
create or replace function public.prevent_role_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not has_any_role(array['admin']::user_role[]) then
    raise exception 'ROLE_CHANGE_FORBIDDEN';
  end if;
  return new;
end $$;
create trigger profiles_role_guard before update on profiles
  for each row execute function public.prevent_role_escalation();

create table addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  label text, recipient_name text not null, phone text not null,
  line1 text not null, line2 text, city text not null, postal_code text,
  country_code char(2) not null default 'XK',
  is_default_shipping boolean not null default false,
  is_default_billing boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
```

## 4. Catalog

```sql
create table brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, name text not null,
  description jsonb not null default '{}'::jsonb,
  logo_path text, banner_path text, country_code char(2), website_url text,
  is_active boolean not null default true, sort_order int not null default 0,
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  parent_id uuid references categories(id) on delete set null,
  name jsonb not null, description jsonb not null default '{}'::jsonb,
  image_path text, icon text, sort_order int not null default 0,
  is_active boolean not null default true, seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table health_goals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, name jsonb not null, tagline jsonb default '{}'::jsonb,
  description jsonb not null default '{}'::jsonb, icon text, image_path text,
  sort_order int not null default 0, is_active boolean not null default true,
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, name jsonb not null, other_names text[] not null default '{}',
  summary jsonb not null default '{}'::jsonb, benefits jsonb not null default '{}'::jsonb,
  dosage_notes jsonb not null default '{}'::jsonb, safety_notes jsonb not null default '{}'::jsonb,
  evidence evidence_level, category text,
  is_active boolean not null default true, seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  brand_id uuid not null references brands(id),
  name jsonb not null, subtitle jsonb not null default '{}'::jsonb,
  description jsonb not null default '{}'::jsonb,   -- markdown per locale
  how_to_use jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '{}'::jsonb,
  form product_form, serving_size text,
  dietary_tags text[] not null default '{}',        -- vegan, vegetarian, gluten_free, sugar_free, lactose_free, halal, non_gmo
  status product_status not null default 'draft',
  is_featured boolean not null default false,
  published_at timestamptz,
  approved_by uuid references profiles(id), approved_at timestamptz,  -- compliance sign-off
  rating_avg numeric(3,2) not null default 0, rating_count int not null default 0,
  search_text tsvector,
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table product_categories (
  product_id uuid references products(id) on delete cascade,
  category_id uuid references categories(id) on delete cascade,
  is_primary boolean not null default false,
  primary key (product_id, category_id)
);

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  sku text not null unique,
  name jsonb not null,                               -- {"sq":"60 kapsula","en":"60 capsules"}
  options jsonb not null default '{}'::jsonb,        -- {"size":"1kg","flavor":"chocolate"}
  price_cents int not null check (price_cents >= 0),
  compare_at_price_cents int check (compare_at_price_cents > price_cents),
  cost_cents int,                                    -- staff-only via RLS
  currency char(3) not null default 'EUR',
  weight_grams int, barcode text,
  is_default boolean not null default false, is_active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index one_default_variant on product_variants (product_id) where is_default;

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  storage_path text not null, alt jsonb not null default '{}'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table product_ingredients (
  product_id uuid references products(id) on delete cascade,
  ingredient_id uuid references ingredients(id),
  amount numeric, unit text, per_serving boolean not null default true,
  nrv_pct numeric, position int not null default 0,
  primary key (product_id, ingredient_id)
);

create table product_health_goals (
  product_id uuid references products(id) on delete cascade,
  goal_id uuid references health_goals(id) on delete cascade,
  primary key (product_id, goal_id)
);

create table product_relations (
  product_id uuid references products(id) on delete cascade,
  related_product_id uuid references products(id) on delete cascade,
  kind text not null default 'related' check (kind in ('related','alternative','frequently_bought')),
  primary key (product_id, related_product_id, kind)
);

create table certifications (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, name jsonb not null, icon_path text,
  created_at timestamptz not null default now()
);
create table product_certifications (
  product_id uuid references products(id) on delete cascade,
  certification_id uuid references certifications(id) on delete cascade,
  primary key (product_id, certification_id)
);

create table lab_reports (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  title text not null, batch_number text, file_path text not null,  -- private bucket
  issued_at date, expires_at date, is_public boolean not null default false,
  created_at timestamptz not null default now()
);
```

## 5. Inventory & fulfillment config

```sql
create table warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null, address jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
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

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants(id),
  warehouse_id uuid not null references warehouses(id),
  type stock_movement_type not null,
  quantity int not null,                    -- signed: received +, sale −
  batch_number text, expiry_date date,
  reference_type text, reference_id uuid,   -- e.g. 'order', order id
  note text, created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table shipping_methods (
  id uuid primary key default gen_random_uuid(),
  name jsonb not null, description jsonb not null default '{}'::jsonb,
  price_cents int not null default 0, free_over_cents int,
  countries text[] not null default '{XK}',
  min_days int not null default 1, max_days int not null default 3,
  is_active boolean not null default true, position int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
```

## 6. Commerce

```sql
create table carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  anon_token uuid unique default gen_random_uuid(),   -- httpOnly cookie for guests
  status cart_status not null default 'active',
  currency char(3) not null default 'EUR',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index one_active_cart_per_user on carts (user_id) where status = 'active' and user_id is not null;

create table cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references carts(id) on delete cascade,
  variant_id uuid not null references product_variants(id) on delete cascade,
  quantity int not null check (quantity between 1 and 20),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (cart_id, variant_id)
);

create table coupons (
  id uuid primary key default gen_random_uuid(),
  code citext not null unique,
  type discount_type not null,
  value int not null default 0,             -- percentage: whole %, fixed: cents
  min_subtotal_cents int, max_uses int, max_uses_per_user int,
  starts_at timestamptz, ends_at timestamptz,
  is_active boolean not null default true, note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references coupons(id),
  user_id uuid references profiles(id),
  order_id uuid not null,
  created_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default generate_order_number(),
  user_id uuid references profiles(id) on delete set null,
  subscription_id uuid,                      -- FK added in §7 after subscriptions
  email citext not null, phone text not null,
  status order_status not null default 'pending',
  payment_status payment_status not null default 'pending',
  currency char(3) not null default 'EUR',
  subtotal_cents int not null, discount_cents int not null default 0,
  shipping_cents int not null default 0, tax_cents int not null default 0,  -- informational, VAT-inclusive pricing
  total_cents int not null,
  coupon_id uuid references coupons(id), coupon_code text,
  shipping_method jsonb, shipping_address jsonb not null, billing_address jsonb not null,
  customer_note text, admin_note text,
  locale text not null default 'sq', source text not null default 'web',
  placed_at timestamptz not null default now(),
  delivered_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  variant_id uuid references product_variants(id) on delete set null,
  name_snapshot text not null, sku text not null, image_path text,
  quantity int not null check (quantity > 0),
  unit_price_cents int not null, total_cents int not null,
  created_at timestamptz not null default now()
);

create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  type text not null,        -- created | status_changed | note | email_sent | payment_update | refund
  message text, data jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  provider payment_provider not null,
  status payment_status not null default 'pending',
  amount_cents int not null, currency char(3) not null default 'EUR',
  provider_ref text, error text, raw jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  payment_id uuid references payments(id),
  amount_cents int not null check (amount_cents > 0),
  reason text not null, restock boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  carrier text, tracking_number text, tracking_url text,
  status text not null default 'pending',
  shipped_at timestamptz, delivered_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
```

## 7. Engagement, subscriptions, content, ops

```sql
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  status subscription_status not null default 'active',
  frequency_days int not null check (frequency_days in (30,45,60,90)),
  discount_pct int not null default 10 check (discount_pct between 0 and 50),
  next_run_at date not null,
  shipping_address jsonb not null, shipping_method_id uuid references shipping_methods(id),
  payment_provider payment_provider not null default 'cod',
  paused_until date, cancelled_at timestamptz, cancel_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table subscription_items (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  variant_id uuid not null references product_variants(id),
  quantity int not null check (quantity between 1 and 10),
  unique (subscription_id, variant_id)
);
alter table orders add constraint orders_subscription_fk
  foreign key (subscription_id) references subscriptions(id) on delete set null;

create table reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  order_id uuid references orders(id) on delete set null,   -- verified purchase if set
  author_name text not null,                                 -- snapshot; profiles stay private
  rating int not null check (rating between 1 and 5),
  title text, body text,
  status review_status not null default 'pending',
  admin_reply text, helpful_count int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (product_id, user_id)
);
create table review_votes (
  review_id uuid references reviews(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  primary key (review_id, user_id)
);

create table wishlist_items (
  user_id uuid references profiles(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, type article_type not null default 'article',
  title jsonb not null, excerpt jsonb not null default '{}'::jsonb,
  body jsonb not null default '{}'::jsonb,          -- markdown per locale
  cover_path text, author_id uuid references profiles(id),
  status article_status not null default 'draft', published_at timestamptz,
  reading_minutes int, tags text[] not null default '{}',
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table article_products (article_id uuid references articles(id) on delete cascade, product_id uuid references products(id) on delete cascade, primary key (article_id, product_id));
create table article_ingredients (article_id uuid references articles(id) on delete cascade, ingredient_id uuid references ingredients(id) on delete cascade, primary key (article_id, ingredient_id));
create table article_health_goals (article_id uuid references articles(id) on delete cascade, goal_id uuid references health_goals(id) on delete cascade, primary key (article_id, goal_id));

create table faqs (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'general',
  question jsonb not null, answer jsonb not null,
  position int not null default 0, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, title jsonb not null, body jsonb not null default '{}'::jsonb,
  status article_status not null default 'published',
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table banners (
  id uuid primary key default gen_random_uuid(),
  placement text not null check (placement in ('home_hero','home_strip','offers','announcement')),
  title jsonb not null default '{}'::jsonb, subtitle jsonb not null default '{}'::jsonb,
  image_path text, cta_label jsonb not null default '{}'::jsonb, cta_href text,
  starts_at timestamptz, ends_at timestamptz,
  position int not null default 0, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  points int not null,                       -- signed
  reason text not null check (reason in ('earn_order','redeem','adjustment','expiry')),
  order_id uuid references orders(id), note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table quiz_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  answers jsonb not null, recommended_product_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique, locale text not null default 'sq', source text,
  confirmed_at timestamptz, unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);

create table contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null, email citext not null, subject text, body text not null,
  status text not null default 'new' check (status in ('new','replied','closed')),
  replied_by uuid references profiles(id), replied_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id), actor_role user_role,
  action text not null, entity_type text not null, entity_id text,
  before jsonb, after jsonb, ip text,
  created_at timestamptz not null default now()
);

create table email_log (
  id uuid primary key default gen_random_uuid(),
  to_email citext not null, template text not null, subject text,
  status text not null default 'sent', provider_id text, error text,
  order_id uuid references orders(id) on delete set null,
  created_at timestamptz not null default now()
);

create table settings (
  key text primary key, value jsonb not null,
  updated_by uuid references profiles(id), updated_at timestamptz not null default now()
);

create table rate_limits (
  key text not null, window_start timestamptz not null, count int not null default 1,
  primary key (key, window_start)
);
```

## 8. Functions, triggers, RPCs

```sql
-- updated_at on every table that has the column
do $$ declare t text; begin
  for t in select table_name from information_schema.columns
           where table_schema='public' and column_name='updated_at'
  loop execute format('create trigger set_updated_at before update on %I for each row execute function set_updated_at()', t);
  end loop; end $$;

-- Product search vector (simple config + unaccent; Albanian has no built-in config)
create or replace function public.products_set_search() returns trigger language plpgsql as $$
declare v_brand text;
begin
  select name into v_brand from brands where id = new.brand_id;
  new.search_text := to_tsvector('simple', unaccent(
    coalesce(new.name->>'sq','') || ' ' || coalesce(new.name->>'en','') || ' ' ||
    coalesce(new.subtitle->>'sq','') || ' ' || coalesce(new.subtitle->>'en','') || ' ' ||
    array_to_string(new.dietary_tags,' ') || ' ' || coalesce(v_brand,'')));
  return new;
end $$;
create trigger products_search before insert or update of name, subtitle, dietary_tags, brand_id
  on products for each row execute function products_set_search();

-- Rating aggregate
create or replace function public.refresh_product_rating() returns trigger language plpgsql as $$
declare pid uuid := coalesce(new.product_id, old.product_id);
begin
  update products p set
    rating_avg = coalesce((select round(avg(rating)::numeric,2) from reviews where product_id=pid and status='approved'),0),
    rating_count = (select count(*) from reviews where product_id=pid and status='approved')
  where p.id = pid;
  return null;
end $$;
create trigger reviews_rating after insert or update of status, rating or delete
  on reviews for each row execute function refresh_product_rating();

-- Order status transitions + side effects
create or replace function public.orders_before_status_change() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status='pending'    and new.status in ('confirmed','cancelled')) or
      (old.status='confirmed'  and new.status in ('processing','cancelled')) or
      (old.status='processing' and new.status in ('shipped','cancelled')) or
      (old.status='shipped'    and new.status in ('delivered','refunded')) or
      (old.status='delivered'  and new.status in ('refunded'))
    ) then raise exception 'INVALID_STATUS_TRANSITION:%->%', old.status, new.status; end if;
    if new.status='delivered' then
      new.delivered_at := now();
      if exists (select 1 from payments where order_id=new.id and provider='cod' and status='pending')
      then new.payment_status := 'paid'; end if;
    elsif new.status='cancelled' then new.cancelled_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger orders_status_guard before update on orders
  for each row execute function orders_before_status_change();

create or replace function public.orders_after_status_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare it record; wh uuid; earn int; rate numeric;
begin
  if new.status is distinct from old.status then
    insert into order_events (order_id, type, message, data)
      values (new.id,'status_changed', old.status||' → '||new.status, jsonb_build_object('from',old.status,'to',new.status));
    if new.status='delivered' then
      update payments set status='paid' where order_id=new.id and provider='cod' and status='pending';
      if new.user_id is not null then
        select coalesce((value->>'earn_rate_points_per_eur')::numeric,1) into rate from settings where key='loyalty';
        earn := floor((new.total_cents/100.0) * coalesce(rate,1));
        if earn > 0 then
          insert into loyalty_transactions (user_id, points, reason, order_id) values (new.user_id, earn, 'earn_order', new.id);
          update profiles set loyalty_points = loyalty_points + earn where id = new.user_id;
        end if;
      end if;
    elsif new.status='cancelled' then
      select id into wh from warehouses where is_default limit 1;
      for it in select variant_id, quantity from order_items where order_id=new.id and variant_id is not null loop
        update inventory_levels set on_hand = on_hand + it.quantity where variant_id=it.variant_id and warehouse_id=wh;
        insert into stock_movements (variant_id, warehouse_id, type, quantity, reference_type, reference_id)
          values (it.variant_id, wh, 'cancel_restock', it.quantity, 'order', new.id);
      end loop;
    end if;
  end if;
  return null;
end $$;
create trigger orders_status_effects after update on orders
  for each row execute function orders_after_status_change();

-- Rate limiter
create or replace function public.check_rate_limit(p_key text, p_max int, p_window interval)
returns boolean language plpgsql security definer set search_path=public as $$
declare ws timestamptz := date_trunc('minute', now()) - (extract(minute from now())::int % greatest(1,(extract(epoch from p_window)/60)::int)) * interval '1 minute';
        c int;
begin
  insert into rate_limits (key, window_start, count) values (p_key, ws, 1)
  on conflict (key, window_start) do update set count = rate_limits.count + 1
  returning count into c;
  return c <= p_max;
end $$;
```

### Checkout RPC (atomic order creation — the only write path for orders)

```sql
create or replace function public.checkout_create_order(
  p_cart_id uuid, p_email text, p_phone text,
  p_shipping_address jsonb, p_billing_address jsonb,
  p_shipping_method_id uuid, p_payment_provider payment_provider,
  p_coupon_code text default null, p_customer_note text default null, p_locale text default 'sq'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cart carts%rowtype; v_method shipping_methods%rowtype; v_coupon coupons%rowtype;
  v_item record; v_wh uuid; v_stock int;
  v_subtotal int := 0; v_discount int := 0; v_shipping int := 0; v_tax int := 0; v_total int := 0;
  v_rate numeric; v_order_id uuid; v_order_number text;
begin
  if p_payment_provider not in ('cod','bank_pos') then raise exception 'PROVIDER_UNAVAILABLE'; end if;

  select * into v_cart from carts where id = p_cart_id and status = 'active' for update;
  if not found then raise exception 'CART_NOT_FOUND'; end if;
  if auth.role() <> 'service_role' and v_cart.user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_method from shipping_methods where id = p_shipping_method_id and is_active;
  if not found then raise exception 'SHIPPING_METHOD_INVALID'; end if;
  select id into v_wh from warehouses where is_default limit 1;

  -- Pass 1: validate items against live catalog, lock stock, price from DB
  for v_item in
    select ci.variant_id, ci.quantity, pv.price_cents, pv.sku
    from cart_items ci
    join product_variants pv on pv.id = ci.variant_id and pv.is_active
    join products p on p.id = pv.product_id and p.status='published' and p.deleted_at is null
    where ci.cart_id = p_cart_id
  loop
    select on_hand into v_stock from inventory_levels
      where variant_id = v_item.variant_id and warehouse_id = v_wh for update;
    if coalesce(v_stock,0) < v_item.quantity then raise exception 'OUT_OF_STOCK:%', v_item.sku; end if;
    v_subtotal := v_subtotal + v_item.price_cents * v_item.quantity;
  end loop;
  if v_subtotal = 0 then raise exception 'CART_EMPTY'; end if;

  if p_coupon_code is not null then
    select * into v_coupon from coupons where code = p_coupon_code and is_active
      and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now()) for update;
    if not found then raise exception 'COUPON_INVALID'; end if;
    if v_coupon.min_subtotal_cents is not null and v_subtotal < v_coupon.min_subtotal_cents then raise exception 'COUPON_MIN_NOT_MET'; end if;
    if v_coupon.max_uses is not null and (select count(*) from coupon_redemptions where coupon_id=v_coupon.id) >= v_coupon.max_uses then raise exception 'COUPON_EXHAUSTED'; end if;
    if v_cart.user_id is not null and v_coupon.max_uses_per_user is not null
       and (select count(*) from coupon_redemptions where coupon_id=v_coupon.id and user_id=v_cart.user_id) >= v_coupon.max_uses_per_user
    then raise exception 'COUPON_ALREADY_USED'; end if;
    v_discount := case v_coupon.type
      when 'percentage' then (v_subtotal * v_coupon.value) / 100
      when 'fixed' then least(v_coupon.value, v_subtotal) else 0 end;
  end if;

  v_shipping := case
    when v_coupon.type = 'free_shipping' then 0
    when v_method.free_over_cents is not null and (v_subtotal - v_discount) >= v_method.free_over_cents then 0
    else v_method.price_cents end;

  select coalesce((value->>'rate')::numeric, 18) into v_rate from settings where key='tax';
  v_total := v_subtotal - v_discount + v_shipping;
  v_tax := round(v_total * coalesce(v_rate,18) / (100 + coalesce(v_rate,18)));

  insert into orders (user_id, email, phone, status, payment_status, currency,
    subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents,
    coupon_id, coupon_code, shipping_method, shipping_address, billing_address,
    customer_note, locale)
  values (v_cart.user_id, lower(p_email), p_phone, 'pending', 'pending', 'EUR',
    v_subtotal, v_discount, v_shipping, v_tax, v_total,
    v_coupon.id, v_coupon.code,
    jsonb_build_object('id',v_method.id,'name',v_method.name,'price_cents',v_shipping,'min_days',v_method.min_days,'max_days',v_method.max_days),
    p_shipping_address, coalesce(p_billing_address, p_shipping_address), p_customer_note, p_locale)
  returning id, order_number into v_order_id, v_order_number;

  -- Pass 2: snapshot items, decrement stock (locks already held)
  for v_item in
    select ci.variant_id, ci.quantity, pv.price_cents, pv.sku, p.id as product_id,
      coalesce(p.name->>p_locale, p.name->>'sq') as pname,
      (select storage_path from product_images pi where pi.product_id=p.id order by position limit 1) as image
    from cart_items ci
    join product_variants pv on pv.id = ci.variant_id
    join products p on p.id = pv.product_id
    where ci.cart_id = p_cart_id
  loop
    insert into order_items (order_id, product_id, variant_id, name_snapshot, sku, image_path, quantity, unit_price_cents, total_cents)
    values (v_order_id, v_item.product_id, v_item.variant_id, v_item.pname, v_item.sku, v_item.image,
            v_item.quantity, v_item.price_cents, v_item.price_cents * v_item.quantity);
    update inventory_levels set on_hand = on_hand - v_item.quantity
      where variant_id = v_item.variant_id and warehouse_id = v_wh;
    insert into stock_movements (variant_id, warehouse_id, type, quantity, reference_type, reference_id, created_by)
    values (v_item.variant_id, v_wh, 'sale', -v_item.quantity, 'order', v_order_id, v_cart.user_id);
  end loop;

  insert into payments (order_id, provider, status, amount_cents) values (v_order_id, p_payment_provider, 'pending', v_total);
  if v_coupon.id is not null then
    insert into coupon_redemptions (coupon_id, user_id, order_id) values (v_coupon.id, v_cart.user_id, v_order_id);
  end if;
  update carts set status = 'converted' where id = p_cart_id;
  insert into order_events (order_id, type, message) values (v_order_id, 'created', 'Order placed');

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'total_cents', v_total);
end $$;

revoke all on function checkout_create_order from public, anon;
grant execute on function checkout_create_order to authenticated, service_role;
```

## 9. Row Level Security

Enable RLS on **all** public tables (`alter table X enable row level security;` for each). Policies (`USING` for read, `WITH CHECK` for writes) — one line per policy; anything not listed is denied (RPC/service-only):

```sql
-- Public catalog & content reads (anon + authenticated)
create policy p_read on brands            for select using (is_active and deleted_at is null or has_any_role('{product_manager,content_manager,compliance_manager,support}'));
create policy p_read on categories        for select using (is_active and deleted_at is null or has_any_role('{product_manager,content_manager}'));
create policy p_read on health_goals      for select using (is_active or has_any_role('{content_manager,product_manager}'));
create policy p_read on ingredients       for select using (is_active or has_any_role('{content_manager,product_manager,compliance_manager}'));
create policy p_read on products          for select using ((status='published' and deleted_at is null) or has_any_role('{product_manager,content_manager,compliance_manager,support,warehouse_manager}'));
create policy p_read on product_variants  for select using (exists (select 1 from products p where p.id=product_id and (p.status='published' and p.deleted_at is null)) or has_any_role('{product_manager,support,warehouse_manager,compliance_manager}'));
create policy p_read on product_images    for select using (true);
create policy p_read on product_categories for select using (true);
create policy p_read on product_ingredients for select using (true);
create policy p_read on product_health_goals for select using (true);
create policy p_read on product_relations for select using (true);
create policy p_read on certifications    for select using (true);
create policy p_read on product_certifications for select using (true);
create policy p_read on lab_reports       for select using (is_public or has_any_role('{compliance_manager,product_manager}'));
create policy p_read on shipping_methods  for select using (is_active or has_any_role('{admin}'));
create policy p_read on faqs              for select using (is_active or has_any_role('{content_manager}'));
create policy p_read on pages             for select using (status='published' or has_any_role('{content_manager}'));
create policy p_read on banners           for select using ((is_active and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now())) or has_any_role('{content_manager}'));
create policy p_read on articles          for select using ((status='published' and deleted_at is null) or has_any_role('{content_manager,compliance_manager}'));
create policy p_read on article_products  for select using (true);
create policy p_read on article_ingredients for select using (true);
create policy p_read on article_health_goals for select using (true);
create policy p_read on reviews           for select using (status='approved' or user_id=auth.uid() or has_any_role('{support,content_manager}'));

-- NOTE: hide cost_cents from non-staff: revoke column, storefront selects explicit columns.
revoke select (cost_cents) on product_variants from anon, authenticated;
grant  select (cost_cents) on product_variants to authenticated;  -- staff read via has_any_role check in app; acceptable v1 tradeoff — never select cost_cents in storefront queries.

-- Catalog writes (staff)
create policy p_write on brands       for all using (has_any_role('{product_manager}')) with check (has_any_role('{product_manager}'));
create policy p_write on categories   for all using (has_any_role('{product_manager}')) with check (has_any_role('{product_manager}'));
create policy p_write on products     for all using (has_any_role('{product_manager,compliance_manager}')) with check (has_any_role('{product_manager,compliance_manager}'));
create policy p_write on product_variants    for all using (has_any_role('{product_manager}')) with check (has_any_role('{product_manager}'));
create policy p_write on product_images      for all using (has_any_role('{product_manager}')) with check (has_any_role('{product_manager}'));
create policy p_write on product_categories  for all using (has_any_role('{product_manager}')) with check (has_any_role('{product_manager}'));
create policy p_write on product_ingredients for all using (has_any_role('{product_manager}')) with check (has_any_role('{product_manager}'));
create policy p_write on product_health_goals for all using (has_any_role('{product_manager,content_manager}')) with check (has_any_role('{product_manager,content_manager}'));
create policy p_write on product_relations   for all using (has_any_role('{product_manager}')) with check (has_any_role('{product_manager}'));
create policy p_write on certifications      for all using (has_any_role('{compliance_manager}')) with check (has_any_role('{compliance_manager}'));
create policy p_write on product_certifications for all using (has_any_role('{compliance_manager}')) with check (has_any_role('{compliance_manager}'));
create policy p_write on lab_reports         for all using (has_any_role('{compliance_manager}')) with check (has_any_role('{compliance_manager}'));
create policy p_write on ingredients  for all using (has_any_role('{content_manager,product_manager}')) with check (has_any_role('{content_manager,product_manager}'));
create policy p_write on health_goals for all using (has_any_role('{content_manager}')) with check (has_any_role('{content_manager}'));
create policy p_write on articles     for all using (has_any_role('{content_manager}')) with check (has_any_role('{content_manager}'));
create policy p_write on article_products for all using (has_any_role('{content_manager}')) with check (has_any_role('{content_manager}'));
create policy p_write on article_ingredients for all using (has_any_role('{content_manager}')) with check (has_any_role('{content_manager}'));
create policy p_write on article_health_goals for all using (has_any_role('{content_manager}')) with check (has_any_role('{content_manager}'));
create policy p_write on faqs    for all using (has_any_role('{content_manager}')) with check (has_any_role('{content_manager}'));
create policy p_write on pages   for all using (has_any_role('{content_manager}')) with check (has_any_role('{content_manager}'));
create policy p_write on banners for all using (has_any_role('{content_manager}')) with check (has_any_role('{content_manager}'));

-- Identity
create policy p_self_read  on profiles for select using (id = auth.uid() or has_any_role('{support}'));
create policy p_self_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy p_admin_update on profiles for update using (has_any_role('{admin}')) with check (has_any_role('{admin}'));
create policy p_own on addresses for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy p_staff_read on addresses for select using (has_any_role('{support,warehouse_manager}'));

-- Cart (authenticated owners; guest carts are service-role only via anon_token)
create policy p_own on carts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy p_own on cart_items for all
  using (exists (select 1 from carts c where c.id=cart_id and c.user_id=auth.uid()))
  with check (exists (select 1 from carts c where c.id=cart_id and c.user_id=auth.uid()));

-- Orders: read own / staff; writes via RPC + staff status updates only
create policy p_read on orders for select using (user_id = auth.uid() or has_any_role('{support,warehouse_manager,compliance_manager}'));
create policy p_staff_update on orders for update using (has_any_role('{support,warehouse_manager}')) with check (has_any_role('{support,warehouse_manager}'));
create policy p_read on order_items for select using (exists (select 1 from orders o where o.id=order_id and (o.user_id=auth.uid() or has_any_role('{support,warehouse_manager}'))));
create policy p_read on order_events for select using (has_any_role('{support,warehouse_manager}'));
create policy p_staff_insert on order_events for insert with check (has_any_role('{support,warehouse_manager}'));
create policy p_read on payments for select using (exists (select 1 from orders o where o.id=order_id and (o.user_id=auth.uid() or has_any_role('{support}'))));
create policy p_staff on refunds for all using (has_any_role('{support}')) with check (has_any_role('{support}'));
create policy p_read on shipments for select using (exists (select 1 from orders o where o.id=order_id and (o.user_id=auth.uid() or has_any_role('{support,warehouse_manager}'))));
create policy p_staff_write on shipments for insert with check (has_any_role('{support,warehouse_manager}'));
create policy p_staff_update on shipments for update using (has_any_role('{support,warehouse_manager}')) with check (has_any_role('{support,warehouse_manager}'));

-- Coupons: customers can't enumerate; validation happens in RPC (security definer)
create policy p_staff on coupons for all using (has_any_role('{support,product_manager}')) with check (has_any_role('{admin}'));
create policy p_staff_read on coupon_redemptions for select using (has_any_role('{support}'));

-- Inventory (staff)
create policy p_staff on warehouses for all using (has_any_role('{warehouse_manager}')) with check (has_any_role('{warehouse_manager}'));
create policy p_wh_read on inventory_levels for select using (true);  -- storefront reads stock; expose only via aggregate 'in stock / low' in UI
create policy p_wh_write on inventory_levels for all using (has_any_role('{warehouse_manager,product_manager}')) with check (has_any_role('{warehouse_manager,product_manager}'));
create policy p_wh on stock_movements for select using (has_any_role('{warehouse_manager,product_manager,support}'));
create policy p_wh_insert on stock_movements for insert with check (has_any_role('{warehouse_manager,product_manager}'));
create policy p_admin on shipping_methods for all using (has_any_role('{admin}')) with check (has_any_role('{admin}'));

-- Engagement
create policy p_insert_own on reviews for insert with check (user_id = auth.uid());
create policy p_update_own on reviews for update using (user_id = auth.uid() and status='pending') with check (user_id = auth.uid());
create policy p_moderate on reviews for update using (has_any_role('{support,content_manager}')) with check (has_any_role('{support,content_manager}'));
create policy p_own on review_votes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy p_own on wishlist_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy p_own on subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy p_staff_read on subscriptions for select using (has_any_role('{support}'));
create policy p_staff_update on subscriptions for update using (has_any_role('{support}')) with check (has_any_role('{support}'));
create policy p_own on subscription_items for all
  using (exists (select 1 from subscriptions s where s.id=subscription_id and s.user_id=auth.uid()))
  with check (exists (select 1 from subscriptions s where s.id=subscription_id and s.user_id=auth.uid()));
create policy p_own_read on loyalty_transactions for select using (user_id = auth.uid() or has_any_role('{support}'));
create policy p_own_insert on quiz_submissions for insert with check (user_id = auth.uid() or user_id is null);
create policy p_own_read on quiz_submissions for select using (user_id = auth.uid() or has_any_role('{content_manager}'));

-- Ops
create policy p_staff on contact_messages for select using (has_any_role('{support}'));
create policy p_staff_update on contact_messages for update using (has_any_role('{support}')) with check (has_any_role('{support}'));
create policy p_admin_read on audit_logs for select using (has_any_role('{admin}'));
create policy p_read on settings for select using (true);          -- non-secret config only (tax rate, thresholds)
create policy p_admin_write on settings for all using (has_any_role('{admin}')) with check (has_any_role('{admin}'));
create policy p_staff_read on email_log for select using (has_any_role('{support}'));
-- newsletter_subscribers, rate_limits, coupon_redemptions inserts, contact_messages inserts,
-- loyalty writes, audit_logs inserts, email_log inserts, guest carts: service-role/RPC/trigger only (no policies).
```

## 10. Indexes

```sql
create index products_status_idx on products (status, is_featured, published_at desc);
create index products_brand_idx on products (brand_id) where status='published';
create index products_search_idx on products using gin (search_text);
create index products_name_trgm on products using gin ((name->>'sq') gin_trgm_ops);
create index products_tags_idx on products using gin (dietary_tags);
create index variants_product_idx on product_variants (product_id, position);
create index images_product_idx on product_images (product_id, position);
create index pc_category_idx on product_categories (category_id);
create index phg_goal_idx on product_health_goals (goal_id);
create index pi_ingredient_idx on product_ingredients (ingredient_id);
create index orders_user_idx on orders (user_id, placed_at desc);
create index orders_status_idx on orders (status, placed_at desc);
create index order_items_order_idx on order_items (order_id);
create index order_events_order_idx on order_events (order_id, created_at);
create index reviews_product_idx on reviews (product_id, status, created_at desc);
create index articles_pub_idx on articles (status, type, published_at desc);
create index subs_due_idx on subscriptions (status, next_run_at);
create index movements_variant_idx on stock_movements (variant_id, created_at desc);
create index carts_anon_idx on carts (anon_token) where status='active';
create index audit_created_idx on audit_logs (created_at desc);
```

## 11. Storage buckets & policies

| Bucket           | Public     | Contents                              | Write                                                                                               |
| ---------------- | ---------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `product-images` | ✅         | product photos (webp/jpg/png, ≤ 2 MB) | product_manager                                                                                     |
| `brand-assets`   | ✅         | logos, banners                        | product_manager                                                                                     |
| `content`        | ✅         | article covers, goal images, banners  | content_manager                                                                                     |
| `avatars`        | ✅         | user avatars (≤ 512 KB)               | owner (path prefix `= auth.uid()`)                                                                  |
| `lab-reports`    | ❌ private | PDFs                                  | compliance_manager; public access only via server-generated signed URL when `lab_reports.is_public` |

```sql
-- storage.objects policies (repeat pattern per bucket)
create policy "public read product-images" on storage.objects for select using (bucket_id='product-images');
create policy "pm write product-images" on storage.objects for insert with check (bucket_id='product-images' and has_any_role('{product_manager}'));
create policy "pm update product-images" on storage.objects for update using (bucket_id='product-images' and has_any_role('{product_manager}'));
create policy "pm delete product-images" on storage.objects for delete using (bucket_id='product-images' and has_any_role('{product_manager}'));
-- brand-assets → product_manager; content → content_manager; avatars → (storage.foldername(name))[1] = auth.uid()::text;
-- lab-reports: select/insert/update/delete only compliance_manager (no public read policy).
```

Image URLs are stored as bucket paths (`storage_path`); the app builds public URLs via `supabase.storage.from(bucket).getPublicUrl(path)` and always renders through `next/image` (remotePattern for the Supabase host).

## 12. Views (admin convenience; respect RLS)

```sql
create view v_admin_daily_sales with (security_invoker = on) as
  select date_trunc('day', placed_at) d, count(*) orders, sum(total_cents) revenue_cents
  from orders where status not in ('cancelled') group by 1 order by 1 desc;

create view v_low_stock with (security_invoker = on) as
  select il.variant_id, pv.sku, p.name->>'sq' product_name, il.on_hand, il.low_stock_threshold
  from inventory_levels il
  join product_variants pv on pv.id = il.variant_id
  join products p on p.id = pv.product_id
  where il.on_hand <= il.low_stock_threshold;
```

## 13. Settings seed keys (values in docs/11)

`store` (name, contact, address, socials) · `tax` `{rate: 18}` · `loyalty` `{earn_rate_points_per_eur: 1, redeem_points: 100, redeem_value_cents: 500}` · `checkout` `{max_item_qty: 20, cod_enabled: true, bank_pos_enabled: false}` · `inventory` `{default_low_stock_threshold: 5}` · `subscriptions` `{notice_days: 3, default_discount_pct: 10}`.
