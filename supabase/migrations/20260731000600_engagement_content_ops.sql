-- =============================================================================
-- 06 · Engagement, subscriptions, content, operations
-- Source: docs/03 §7, with the correction in docs/13 §D6.
-- =============================================================================

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  status subscription_status not null default 'active',
  frequency_days int not null check (frequency_days in (30,45,60,90)),
  /*
   * docs/13 §D6 — `p_own for all` makes this column customer-writable, and nothing
   * constrained it beyond 0–50. A trigger below freezes it for non-staff; the actual
   * discount is applied through the system coupon (docs/07 §8.2, docs/13 §A3), so this
   * is a record of the agreed rate, not an input to pricing.
   */
  discount_pct int not null default 10 check (discount_pct between 0 and 50),
  next_run_at date not null,
  shipping_address jsonb not null,
  shipping_method_id uuid references shipping_methods(id),
  payment_provider payment_provider not null default 'cod',
  paused_until date,
  cancelled_at timestamptz,
  cancel_reason text,
  consecutive_failures int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table subscription_items (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  variant_id uuid not null references product_variants(id),
  quantity int not null check (quantity between 1 and 10),
  unique (subscription_id, variant_id)
);

alter table orders
  add constraint orders_subscription_fk
  foreign key (subscription_id) references subscriptions(id) on delete set null;

create or replace function public.guard_subscription_discount() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.discount_pct is distinct from old.discount_pct
     and auth.uid() is not null
     and not is_service_role()
     and not has_any_role(array['admin','support']::user_role[])
  then
    raise exception 'SUBSCRIPTION_DISCOUNT_NOT_CUSTOMER_WRITABLE' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger subscriptions_discount_guard
  before update on subscriptions
  for each row execute function public.guard_subscription_discount();

-- -----------------------------------------------------------------------------
-- Reviews
-- -----------------------------------------------------------------------------

create table reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  -- Verified purchase when set. The insert policy proves the claim (docs/13 §B3).
  order_id uuid references orders(id) on delete set null,
  author_name text not null,                 -- snapshot; profiles stay private
  rating int not null check (rating between 1 and 5),
  title text,
  body text,
  status review_status not null default 'pending',
  rejection_reason text,
  admin_reply text,
  helpful_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, user_id)
);

create table review_votes (
  review_id uuid references reviews(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

create table wishlist_items (
  user_id uuid references profiles(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- -----------------------------------------------------------------------------
-- Content
-- -----------------------------------------------------------------------------

create table articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  type article_type not null default 'article',
  title jsonb not null,
  excerpt jsonb not null default '{}'::jsonb,
  body jsonb not null default '{}'::jsonb,          -- markdown per locale
  cover_path text,
  author_id uuid references profiles(id),
  status article_status not null default 'draft',
  published_at timestamptz,
  reading_minutes int,
  tags text[] not null default '{}',
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table article_products (
  article_id uuid references articles(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  primary key (article_id, product_id)
);
create table article_ingredients (
  article_id uuid references articles(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete cascade,
  primary key (article_id, ingredient_id)
);
create table article_health_goals (
  article_id uuid references articles(id) on delete cascade,
  goal_id uuid references health_goals(id) on delete cascade,
  primary key (article_id, goal_id)
);

create table faqs (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'general',
  question jsonb not null,
  answer jsonb not null,
  position int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title jsonb not null,
  body jsonb not null default '{}'::jsonb,
  status article_status not null default 'published',
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table banners (
  id uuid primary key default gen_random_uuid(),
  placement text not null
    check (placement in ('home_hero','home_strip','offers','announcement')),
  title jsonb not null default '{}'::jsonb,
  subtitle jsonb not null default '{}'::jsonb,
  image_path text,
  cta_label jsonb not null default '{}'::jsonb,
  cta_href text,
  starts_at timestamptz,
  ends_at timestamptz,
  position int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Loyalty, quiz, marketing, operations
-- -----------------------------------------------------------------------------

create table loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  points int not null,                       -- signed
  reason text not null
    check (reason in ('earn_order','redeem','adjustment','expiry','clawback')),
  order_id uuid references orders(id),
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table quiz_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  answers jsonb not null,
  recommended_product_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null unique,
  locale text not null default 'sq' check (locale in ('sq','en')),
  source text,
  confirm_token text,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);

create table contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email extensions.citext not null,
  subject text,
  body text not null,
  status text not null default 'new' check (status in ('new','replied','closed')),
  replied_by uuid references profiles(id),
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  actor_role user_role,
  action text not null,
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  ip text,
  created_at timestamptz not null default now()
);

create table email_log (
  id uuid primary key default gen_random_uuid(),
  to_email extensions.citext not null,
  template text not null,
  subject text,
  status text not null default 'sent',
  provider_id text,
  error text,
  order_id uuid references orders(id) on delete set null,
  created_at timestamptz not null default now()
);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
