-- =============================================================================
-- 03 · Catalog — brands, categories, goals, ingredients, products, variants, media
-- Source: docs/03 §4, with the correction in docs/13 §B2.
-- =============================================================================

create table brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description jsonb not null default '{}'::jsonb,
  logo_path text,
  banner_path text,
  country_code char(2),
  website_url text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  parent_id uuid references categories(id) on delete set null,
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  image_path text,
  icon text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint categories_no_self_parent check (parent_id is null or parent_id <> id)
);

create table health_goals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name jsonb not null,
  tagline jsonb not null default '{}'::jsonb,
  description jsonb not null default '{}'::jsonb,
  icon text,
  image_path text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name jsonb not null,
  other_names text[] not null default '{}',
  summary jsonb not null default '{}'::jsonb,
  benefits jsonb not null default '{}'::jsonb,
  dosage_notes jsonb not null default '{}'::jsonb,
  safety_notes jsonb not null default '{}'::jsonb,
  evidence evidence_level,
  category text,
  is_active boolean not null default true,
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  brand_id uuid not null references brands(id),
  name jsonb not null,
  subtitle jsonb not null default '{}'::jsonb,
  description jsonb not null default '{}'::jsonb,   -- markdown per locale
  how_to_use jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '{}'::jsonb,
  form product_form,
  serving_size text,
  -- vegan, vegetarian, gluten_free, sugar_free, lactose_free, halal, non_gmo
  dietary_tags text[] not null default '{}',
  status product_status not null default 'draft',
  is_featured boolean not null default false,
  published_at timestamptz,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  rating_avg numeric(3,2) not null default 0,
  rating_count int not null default 0,
  search_text tsvector,
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table product_categories (
  product_id uuid references products(id) on delete cascade,
  category_id uuid references categories(id) on delete cascade,
  is_primary boolean not null default false,
  primary key (product_id, category_id)
);
create unique index one_primary_category on product_categories (product_id) where is_primary;

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  sku text not null unique,
  name jsonb not null,                                -- {"sq":"60 kapsula","en":"60 capsules"}
  options jsonb not null default '{}'::jsonb,         -- {"size":"1kg","flavor":"chocolate"}
  price_cents int not null check (price_cents >= 0),
  compare_at_price_cents int check (compare_at_price_cents > price_cents),
  currency char(3) not null default 'EUR',
  weight_grams int,
  barcode text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_default_variant on product_variants (product_id) where is_default;

/*
 * docs/13 §B2 — cost lives in its own table, not as a column on `product_variants`.
 *
 * The original guarded it with `revoke select (cost_cents) … from anon, authenticated`
 * followed by `grant select (cost_cents) … to authenticated`. Two problems: Supabase
 * grants `select` at *table* level, and a column-level REVOKE cannot subtract from a
 * table-level grant (Postgres warns `no privileges could be revoked for column` and
 * access is unchanged) — so the revoke did nothing; and the very next line handed the
 * column to every registered customer anyway.
 *
 * Doing it properly at column level would mean revoking table SELECT and re-granting an
 * explicit column list, which breaks every `select *` the storefront issues. A separate
 * table with staff-only RLS makes `select *` safe by construction and gives margin data
 * a real boundary.
 */
create table product_variant_costs (
  variant_id uuid primary key references product_variants(id) on delete cascade,
  cost_cents int not null check (cost_cents >= 0),
  currency char(3) not null default 'EUR',
  note text,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  storage_path text not null,
  alt jsonb not null default '{}'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table product_ingredients (
  product_id uuid references products(id) on delete cascade,
  ingredient_id uuid references ingredients(id),
  amount numeric,
  unit text,
  per_serving boolean not null default true,
  nrv_pct numeric,
  position int not null default 0,
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
  kind text not null default 'related'
    check (kind in ('related','alternative','frequently_bought')),
  primary key (product_id, related_product_id, kind),
  constraint product_relations_not_self check (product_id <> related_product_id)
);

create table certifications (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name jsonb not null,
  icon_path text,
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
  title text not null,
  batch_number text,
  file_path text not null,           -- private bucket; served via signed URL only
  issued_at date,
  expires_at date,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
