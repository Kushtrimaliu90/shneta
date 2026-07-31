-- =============================================================================
-- Seed — deterministic fixture base (docs/11)
--
-- Idempotent by construction: fixed UUIDs plus `on conflict do update`, so
-- `supabase db reset` and CI produce byte-identical state every time.
--
-- Scope note. This file seeds the parts that PRODUCTION also needs — settings,
-- warehouse, shipping methods, certifications, the category tree, health goals and
-- brands (docs/11 §1, §3, §4, §5). Those are configuration and taxonomy, not demo data.
--
-- The demo catalogue (docs/11 §6–§9: 30 ingredients, 24 products, articles, orders,
-- coupons, subscriptions) is local/staging only and is NOT here yet — see the note at
-- the foot of this file. Prod gets the real catalogue, never this fixture.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Settings (docs/03 §13, docs/11 §1)
-- -----------------------------------------------------------------------------
/*
 * The brand is SHNETA; the registered domain is **shtrejt.com** (shneta.com was taken).
 * The contact address must sit on the domain that actually gets SPF/DKIM/DMARC records,
 * because a From: address on a domain nobody verified goes straight to spam.
 *
 * Social handles are left as `shneta` deliberately — those are account names, not DNS, and
 * they only change if the owner cannot claim them. Replace with the real handles before
 * launch (docs/14 §3, brand assets).
 */
insert into settings (key, value) values
  ('store', jsonb_build_object(
      'name', 'SHNETA',
      'email', 'info@shtrejt.com',
      'phone', '+383 40 000 000',
      'address', 'Prishtinë, Kosovë',
      'instagram', 'https://instagram.com/shneta',
      'tiktok', 'https://tiktok.com/@shneta',
      'facebook', 'https://facebook.com/shneta')),
  ('tax', '{"rate": 18}'::jsonb),
  ('loyalty', '{"earn_rate_points_per_eur": 1, "redeem_points": 100, "redeem_value_cents": 500}'::jsonb),
  ('checkout', '{"max_item_qty": 20, "cod_enabled": true, "bank_pos_enabled": false}'::jsonb),
  ('inventory', '{"default_low_stock_threshold": 5}'::jsonb),
  ('subscriptions', '{"notice_days": 3, "default_discount_pct": 10}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- -----------------------------------------------------------------------------
-- Warehouse — one default operates v1; the schema is multi (docs/07 §11)
-- -----------------------------------------------------------------------------
insert into warehouses (id, code, name, address, is_default) values
  ('11111111-0000-4000-8000-000000000001', 'PRN-01', 'Depo Prishtinë',
   jsonb_build_object('city', 'Prishtinë', 'country_code', 'XK'), true)
on conflict (id) do update
  set code = excluded.code, name = excluded.name, address = excluded.address;

-- -----------------------------------------------------------------------------
-- Shipping methods (docs/11 §1)
-- -----------------------------------------------------------------------------
insert into shipping_methods
  (id, name, description, price_cents, free_over_cents, countries, min_days, max_days, position)
values
  ('22222222-0000-4000-8000-000000000001',
   '{"sq":"Standarde","en":"Standard"}'::jsonb,
   '{"sq":"Dërgesa në të gjithë Kosovën.","en":"Delivery anywhere in Kosovo."}'::jsonb,
   200, 3000, '{XK}', 1, 3, 0),
  ('22222222-0000-4000-8000-000000000002',
   '{"sq":"Ekspres Prishtinë","en":"Express Prishtina"}'::jsonb,
   '{"sq":"Dorëzim brenda ditës në Prishtinë.","en":"Same-day delivery in Prishtina."}'::jsonb,
   400, null, '{XK}', 1, 1, 1)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      price_cents = excluded.price_cents,
      free_over_cents = excluded.free_over_cents,
      min_days = excluded.min_days,
      max_days = excluded.max_days;

-- -----------------------------------------------------------------------------
-- Certifications (docs/11 §7)
-- -----------------------------------------------------------------------------
insert into certifications (id, slug, name) values
  ('33333333-0000-4000-8000-000000000001', 'gmp',      '{"sq":"GMP","en":"GMP"}'::jsonb),
  ('33333333-0000-4000-8000-000000000002', 'non-gmo',  '{"sq":"Pa OMGJ","en":"Non-GMO"}'::jsonb),
  ('33333333-0000-4000-8000-000000000003', 'halal',    '{"sq":"Halall","en":"Halal"}'::jsonb),
  ('33333333-0000-4000-8000-000000000004', 'vegan',    '{"sq":"Vegan","en":"Vegan"}'::jsonb),
  ('33333333-0000-4000-8000-000000000005', 'iso-22000','{"sq":"ISO 22000","en":"ISO 22000"}'::jsonb)
on conflict (id) do update set slug = excluded.slug, name = excluded.name;

-- -----------------------------------------------------------------------------
-- Category tree (docs/11 §3) — parents first, then children
-- -----------------------------------------------------------------------------
insert into categories (id, slug, parent_id, name, sort_order) values
  ('44444444-0000-4000-8000-000000000001','vitaminat',           null,'{"sq":"Vitaminat","en":"Vitamins"}'::jsonb,0),
  ('44444444-0000-4000-8000-000000000002','mineralet',           null,'{"sq":"Mineralet","en":"Minerals"}'::jsonb,1),
  ('44444444-0000-4000-8000-000000000003','nutricion-sportiv',   null,'{"sq":"Nutricion Sportiv","en":"Sports Nutrition"}'::jsonb,2),
  ('44444444-0000-4000-8000-000000000007','omega',               null,'{"sq":"Vajrat Omega","en":"Omega Oils"}'::jsonb,3),
  ('44444444-0000-4000-8000-000000000008','kolagjeni',           null,'{"sq":"Kolagjeni","en":"Collagen"}'::jsonb,4),
  ('44444444-0000-4000-8000-000000000009','bimore',              null,'{"sq":"Suplemente Bimore","en":"Herbal"}'::jsonb,5),
  ('44444444-0000-4000-8000-00000000000a','adaptogjenet',        null,'{"sq":"Adaptogjenët","en":"Adaptogens"}'::jsonb,6),
  ('44444444-0000-4000-8000-00000000000b','probiotiket',         null,'{"sq":"Probiotikët","en":"Probiotics"}'::jsonb,7),
  ('44444444-0000-4000-8000-00000000000c','elektrolitet',        null,'{"sq":"Elektrolitët","en":"Electrolytes"}'::jsonb,8),
  ('44444444-0000-4000-8000-00000000000d','ushqime-funksionale', null,'{"sq":"Ushqime Funksionale","en":"Functional Foods"}'::jsonb,9),
  ('44444444-0000-4000-8000-00000000000e','aksesore',            null,'{"sq":"Aksesorë","en":"Accessories"}'::jsonb,10),
  ('44444444-0000-4000-8000-00000000000f','pako',                null,'{"sq":"Pako & Bundles","en":"Bundles"}'::jsonb,11),
  ('44444444-0000-4000-8000-000000000010','karta-dhurate',       null,'{"sq":"Karta Dhuratë","en":"Gift Cards"}'::jsonb,12)
on conflict (id) do update
  set slug = excluded.slug, name = excluded.name, sort_order = excluded.sort_order;

insert into categories (id, slug, parent_id, name, sort_order) values
  ('44444444-0000-4000-8000-000000000004','proteina',   '44444444-0000-4000-8000-000000000003','{"sq":"Proteina","en":"Protein"}'::jsonb,0),
  ('44444444-0000-4000-8000-000000000005','kreatina',   '44444444-0000-4000-8000-000000000003','{"sq":"Kreatina","en":"Creatine"}'::jsonb,1),
  ('44444444-0000-4000-8000-000000000006','aminoacidet','44444444-0000-4000-8000-000000000003','{"sq":"Aminoacidet","en":"Amino Acids"}'::jsonb,2)
on conflict (id) do update
  set slug = excluded.slug, parent_id = excluded.parent_id,
      name = excluded.name, sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- Health goals (docs/11 §4) — 16 SEO landing pages.
-- `description` carries a [CONTENT: replace] marker: docs/05 §5 requires a unique
-- 150+ word intro per goal, written by the content team before launch.
-- -----------------------------------------------------------------------------
insert into health_goals (id, slug, name, tagline, description, icon, sort_order) values
  ('55555555-0000-4000-8000-000000000001','energji','{"sq":"Energji","en":"Energy"}'::jsonb,'{"sq":"Mbështetje për energjinë e përditshme","en":"Support for everyday energy"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'zap',0),
  ('55555555-0000-4000-8000-000000000002','gjumi','{"sq":"Gjumë më i mirë","en":"Better Sleep"}'::jsonb,'{"sq":"Për një rutinë të qetë nate","en":"For a calmer night routine"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'moon',1),
  ('55555555-0000-4000-8000-000000000003','imuniteti','{"sq":"Imuniteti","en":"Immunity"}'::jsonb,'{"sq":"Mbështetje për sistemin imunitar","en":"Immune system support"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'shield',2),
  ('55555555-0000-4000-8000-000000000004','stresi','{"sq":"Stresi","en":"Stress"}'::jsonb,'{"sq":"Ekuilibër në ditët e ngarkuara","en":"Balance on busy days"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'wind',3),
  ('55555555-0000-4000-8000-000000000005','truri','{"sq":"Fokus & Tru","en":"Brain & Focus"}'::jsonb,'{"sq":"Përqendrim dhe kthjelltësi","en":"Focus and clarity"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'brain',4),
  ('55555555-0000-4000-8000-000000000006','zemra','{"sq":"Zemra","en":"Heart"}'::jsonb,'{"sq":"Mbështetje kardiovaskulare","en":"Cardiovascular support"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'heart',5),
  ('55555555-0000-4000-8000-000000000007','kockat','{"sq":"Kockat","en":"Bones"}'::jsonb,'{"sq":"Kocka të forta","en":"Strong bones"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'bone',6),
  ('55555555-0000-4000-8000-000000000008','nyjet','{"sq":"Nyjet","en":"Joints"}'::jsonb,'{"sq":"Lëvizje e rehatshme","en":"Comfortable movement"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'activity',7),
  ('55555555-0000-4000-8000-000000000009','shendeti-i-gruas','{"sq":"Shëndeti i Gruas","en":"Women''s Health"}'::jsonb,'{"sq":"Mbështetje në çdo fazë","en":"Support at every stage"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'flower',8),
  ('55555555-0000-4000-8000-00000000000a','shendeti-i-burrit','{"sq":"Shëndeti i Burrit","en":"Men''s Health"}'::jsonb,'{"sq":"Vitalitet dhe forcë","en":"Vitality and strength"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'user',9),
  ('55555555-0000-4000-8000-00000000000b','tretja','{"sq":"Tretja","en":"Gut Health"}'::jsonb,'{"sq":"Ekuilibër i tretjes","en":"Digestive balance"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'leaf',10),
  ('55555555-0000-4000-8000-00000000000c','pesha','{"sq":"Menaxhimi i Peshës","en":"Weight Management"}'::jsonb,'{"sq":"Mbështetje për objektivat e tua","en":"Support for your goals"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'scale',11),
  ('55555555-0000-4000-8000-00000000000d','floket','{"sq":"Flokët","en":"Hair"}'::jsonb,'{"sq":"Flokë të shëndetshëm","en":"Healthy hair"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'sparkles',12),
  ('55555555-0000-4000-8000-00000000000e','lekura','{"sq":"Lëkura","en":"Skin"}'::jsonb,'{"sq":"Lëkurë e ndriçuar","en":"Radiant skin"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'sun',13),
  ('55555555-0000-4000-8000-00000000000f','thonjte','{"sq":"Thonjtë","en":"Nails"}'::jsonb,'{"sq":"Thonj të fortë","en":"Strong nails"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'hand',14),
  ('55555555-0000-4000-8000-000000000010','plakja-e-shendetshme','{"sq":"Plakje e Shëndetshme","en":"Healthy Ageing"}'::jsonb,'{"sq":"Mirëqenie afatgjatë","en":"Long-term wellbeing"}'::jsonb,'{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'clock',15)
on conflict (id) do update
  set slug = excluded.slug, name = excluded.name, tagline = excluded.tagline,
      icon = excluded.icon, sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- Brands (docs/11 §5)
-- Real names used as realistic fixtures. Logos are neutral placeholders —
-- REPLACE WITH AUTHORIZED ASSETS before production (docs/11 §5).
-- -----------------------------------------------------------------------------
insert into brands (id, slug, name, country_code, sort_order) values
  ('66666666-0000-4000-8000-000000000001','now-foods','NOW Foods','US',0),
  ('66666666-0000-4000-8000-000000000002','solgar','Solgar','US',1),
  ('66666666-0000-4000-8000-000000000003','optimum-nutrition','Optimum Nutrition','US',2),
  ('66666666-0000-4000-8000-000000000004','myprotein','MyProtein','GB',3),
  ('66666666-0000-4000-8000-000000000005','biotechusa','BioTechUSA','HU',4),
  ('66666666-0000-4000-8000-000000000006','terranova','Terranova','GB',5),
  ('66666666-0000-4000-8000-000000000007','jamieson','Jamieson','CA',6),
  ('66666666-0000-4000-8000-000000000008','swisse','Swisse','AU',7)
on conflict (id) do update
  set slug = excluded.slug, name = excluded.name,
      country_code = excluded.country_code, sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- Legal and static pages (docs/11 §8). Copy is placeholder and MUST be reviewed
-- by the legal contact before launch (docs/10 §9).
-- -----------------------------------------------------------------------------
insert into pages (id, slug, title, body, status) values
  ('77777777-0000-4000-8000-000000000001','about',
   '{"sq":"Rreth nesh","en":"About us"}'::jsonb,
   '{"sq":"[CONTENT: replace]","en":"[CONTENT: replace]"}'::jsonb,'published'),
  ('77777777-0000-4000-8000-000000000002','terms',
   '{"sq":"Kushtet e përdorimit","en":"Terms of use"}'::jsonb,
   '{"sq":"[LEGAL: review]","en":"[LEGAL: review]"}'::jsonb,'published'),
  ('77777777-0000-4000-8000-000000000003','privacy',
   '{"sq":"Politika e privatësisë","en":"Privacy policy"}'::jsonb,
   '{"sq":"[LEGAL: review]","en":"[LEGAL: review]"}'::jsonb,'published'),
  ('77777777-0000-4000-8000-000000000004','shipping-returns',
   '{"sq":"Dërgesa dhe kthimet","en":"Shipping and returns"}'::jsonb,
   '{"sq":"[LEGAL: review]","en":"[LEGAL: review]"}'::jsonb,'published')
on conflict (id) do update
  set slug = excluded.slug, title = excluded.title, status = excluded.status;

-- -----------------------------------------------------------------------------
-- Banners (docs/11 §8)
-- -----------------------------------------------------------------------------
insert into banners (id, placement, title, subtitle, cta_label, cta_href, position) values
  ('88888888-0000-4000-8000-000000000001','announcement',
   '{"sq":"Dërgesa falas mbi 30 €","en":"Free delivery over €30"}'::jsonb,
   '{}'::jsonb, '{}'::jsonb, null, 0),
  ('88888888-0000-4000-8000-000000000002','home_hero',
   '{"sq":"Shëndeti yt, i thjeshtuar.","en":"Your health, simplified."}'::jsonb,
   '{"sq":"Suplemente origjinale, me përbërës të deklaruar plotësisht.","en":"Genuine supplements, with every ingredient disclosed."}'::jsonb,
   '{"sq":"Shfleto dyqanin","en":"Browse the shop"}'::jsonb, '/shop', 0)
on conflict (id) do update
  set title = excluded.title, subtitle = excluded.subtitle,
      cta_label = excluded.cta_label, cta_href = excluded.cta_href;

-- =============================================================================
-- STILL TO SEED (docs/11 §6–§9) — local and staging only, never production:
--
--   · 30 ingredients with sq+en summary / benefits / dosage / safety
--   · 24 products with variants, images, ingredient rows, certifications,
--     relations and reviews
--   · opening stock — written as `received` stock_movements, NEVER as a direct
--     write to inventory_levels.on_hand, or the ledger invariant breaks on the
--     first row (docs/13 §A7). Use `apply_stock_movement()`.
--   · 6 articles, 10 FAQs
--   · coupons WELCOME10 / FALAS / EXPIRED5, and system SUB-10 with
--     is_system = true and is_active = TRUE (docs/13 §A3 — an inactive system
--     coupon can never be applied by the checkout RPC)
--   · orders, subscription and wishlist fixtures for klienti@shneta.dev
--
-- Auth users come from `scripts/seed-users.ts`, which must run BEFORE this file
-- because the user-dependent fixtures reference its fixed UUIDs (docs/11 §10).
-- =============================================================================
