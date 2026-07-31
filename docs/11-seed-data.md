# 11 · Seed Data

Implemented as `supabase/seed.sql` (+ a small `scripts/seed-users.ts` for auth users via service key, local/staging only). Purpose: realistic dev/E2E fixture. **Prod gets the real catalog, not this seed** (only settings, shipping methods, warehouse, pages skeletons, and the real admin user go to prod). Images: placeholder set in `public/seed/` uploaded to buckets by the seed script; replace with licensed brand assets before launch. All jsonb text provided in sq + en.

## 1. Settings & config

```
settings: store {name:"SHNETA", email:"info@shneta.com", phone:"+383 4X XXX XXX", address:"Prishtinë, Kosovë", instagram, tiktok, facebook}
          tax {rate: 18} · loyalty {earn_rate_points_per_eur:1, redeem_points:100, redeem_value_cents:500}
          checkout {max_item_qty:20, cod_enabled:true, bank_pos_enabled:false}
          inventory {default_low_stock_threshold:5} · subscriptions {notice_days:3, default_discount_pct:10}
warehouse: {code:"PRN-01", name:"Depo Prishtinë", is_default:true}
shipping_methods:
  Standarde / Standard — 200 cents, free_over 3000, XK, 1–3 days
  Ekspres Prishtinë / Express Prishtina — 400 cents, no free-over, XK, 1–1 days
```

## 2. Users (local/staging via script; passwords printed once)

admin@shneta.dev (admin) · pm@shneta.dev (product_manager) · content@shneta.dev (content_manager) · support@shneta.dev (support) · depo@shneta.dev (warehouse_manager) · compliance@shneta.dev (compliance_manager) · klienti@shneta.dev (customer, has 2 delivered orders in fixtures for review/loyalty tests). Prod: create only the real admin via dashboard, then `update profiles set role='admin' where email=…` migration-style one-off.

## 3. Categories (slug · name sq / en) — mega-menu tree

vitaminat · Vitaminat / Vitamins — mineralet · Mineralet / Minerals — nutricion-sportiv · Nutricion Sportiv / Sports Nutrition (children: proteina · Proteina / Protein; kreatina · Kreatina / Creatine; aminoacidet · Aminoacidet / Amino Acids) — omega · Vajrat Omega / Omega Oils — kolagjeni · Kolagjeni / Collagen — bimore · Suplemente Bimore / Herbal — adaptogjenet · Adaptogjenët / Adaptogens — probiotiket · Probiotikët / Probiotics — elektrolitet · Elektrolitët / Electrolytes — ushqime-funksionale · Ushqime Funksionale / Functional Foods — aksesore · Aksesorë / Accessories — pako · Pako & Bundles / Bundles — karta-dhurate · Karta Dhuratë / Gift Cards.

## 4. Health goals (16; slug → sq / en)

energji Energji/Energy · gjumi Gjumë më i mirë/Better Sleep · imuniteti Imuniteti/Immunity · stresi Stresi/Stress · truri Fokus & Tru/Brain & Focus · zemra Zemra/Heart · kockat Kockat/Bones · nyjet Nyjet/Joints · shendeti-i-gruas Shëndeti i Gruas/Women's Health · shendeti-i-burrit Shëndeti i Burrit/Men's Health · tretja Tretja/Gut Health · pesha Menaxhimi i Peshës/Weight Management · floket Flokët/Hair · lekura Lëkura/Skin · thonjte Thonjtë/Nails · plakja-e-shendetshme Plakje e Shëndetshme/Healthy Ageing. Each: icon (lucide name), 150-word intro placeholder text marked `[CONTENT: replace]`.

## 5. Brands (8)

NOW Foods (US) · Solgar (US) · Optimum Nutrition (US) · MyProtein (UK) · BioTechUSA (HU) · Terranova (UK) · Jamieson (CA) · Swisse (AU). Real names as realistic fixtures; logos = neutral placeholders; **replace with authorized assets** before prod.

## 6. Ingredients (30, with evidence level)

Vitamin C (strong) · Vitamin D3 (strong) · Vitamin B12 (strong) · Vitamin B-Complex (moderate) · Folate (strong) · Vitamin K2 (moderate) · Magnesium bisglycinate (moderate) · Zinc (strong) · Iron bisglycinate (strong) · Calcium (strong) · Selenium (moderate) · Iodine (strong) · Omega-3 EPA/DHA (strong) · Collagen peptides (moderate) · Creatine monohydrate (strong) · Whey protein (strong) · Casein (moderate) · Plant protein blend (moderate) · Ashwagandha KSM-66 (moderate) · Rhodiola rosea (emerging) · Ginseng (traditional) · Turmeric/Curcumin (moderate) · Ginger (traditional) · Melatonin (strong) · L-theanine (emerging) · Caffeine (strong) · Probiotic blend 10B CFU (moderate) · Psyllium fiber (strong) · Electrolyte complex (moderate) · Hyaluronic acid (emerging). Each: summary/benefits/dosage/safety sq+en (2–3 sentences each; safety notes real — e.g. melatonin: not for pregnancy, may cause drowsiness).

## 7. Products (24 — brand · name · category · variants € · goals · key ingredients)

1. NOW Vitamin D3 4000 IU — vitaminat — 120 softgels €9.90 / 240 €15.90 — imuniteti, kockat — D3.
2. Solgar Vitamin C 1000 mg — vitaminat — 100 caps €14.90 — imuniteti — C.
3. Solgar Magnesium Bisglycinate — mineralet — 90 caps €18.50 — gjumi, stresi — Mg.
4. NOW Zinc Picolinate 50 mg — mineralet — 120 caps €11.90 — imuniteti — Zn.
5. Jamieson B12 1000 µg — vitaminat — 100 tabs €12.40 — energji — B12.
6. Terranova B-Complex — vitaminat — 50 caps €16.90 — energji, stresi — B-complex.
7. ON Gold Standard Whey — proteina — 900 g Chocolate €34.90 / 900 g Vanilla €34.90 / 2.27 kg Chocolate €69.90 (compare-at €79.90) — pesha, nutricion — whey.
8. MyProtein Impact Whey — proteina — 1 kg Strawberry €27.90 — whey.
9. MyProtein Vegan Blend — proteina — 1 kg €29.90 (vegan tag) — plant protein.
10. ON Micronised Creatine — kreatina — 317 g €24.90 / 634 g €39.90 — energji — creatine.
11. BioTechUSA 100% Creatine — kreatina — 300 g €17.90 — creatine.
12. NOW Omega-3 1000 mg — omega — 100 softgels €13.90 / 200 €22.90 — zemra, truri — EPA/DHA.
13. Solgar Omega 3-6-9 — omega — 60 softgels €19.90 — zemra.
14. Swisse Collagen Peptides — kolagjeni — 300 g €26.90 — lekura, floket, thonjte — collagen, C.
15. Terranova Ashwagandha — adaptogjenet — 50 caps €15.90 — stresi, gjumi — KSM-66.
16. NOW Rhodiola 500 mg — adaptogjenet — 60 caps €14.50 — energji, stresi — rhodiola.
17. Jamieson Melatonin 3 mg — bimore — 100 tabs €9.90 — gjumi — melatonin (warnings seeded).
18. NOW Curcumin — bimore — 60 caps €21.90 — nyjet — curcumin.
19. BioTechUSA Probiotic — probiotiket — 60 caps €16.50 — tretja — probiotic blend.
20. NOW Psyllium Husk — ushqime-funksionale — 500 g €12.90 — tretja — psyllium.
21. MyProtein Electrolyte Tabs — elektrolitet — 20 tabs Lemon €7.90 — energji — electrolytes.
22. Swisse Hair Skin Nails — vitaminat — 60 tabs €18.90 — floket, lekura, thonjte — HA, C, Zn.
23. SHNETA Shaker 600 ml — aksesore — Black €6.90 / Green €6.90 — (no ingredients).
24. Pako Imuniteti (bundle) — pako — 1 set €29.90 (compare-at €36.70) — imuniteti — references products 1, 2, 4 in description; ingredients union.
    Each product: ~120-word description, how-to-use, warnings where sensible, 2 images, ingredient rows with amounts + %NRV where standard, one certification sample set (GMP, Non-GMO, Halal on 4–5 items), stock 25–120 (product 21 stock=3 → low-stock fixture; one variant of product 7 stock=0 → OOS fixture), relations (7↔10 frequently_bought, 1↔2 related), reviews: 12 approved across products (varied ratings incl. one 2★), 2 pending. Products 1 & 7 `is_featured`.

## 8. Content

Articles (6, sq full / en full): guide "Si të zgjedhësh proteinën e duhur / How to choose the right protein" (links 7,8,9) · guide "Udhëzues për Vitaminën D / A guide to Vitamin D" (links 1) · article "Magnezi dhe gjumi / Magnesium and sleep" (links 3,17) · recipe "Smoothie proteinik pas stërvitjes / Post-workout protein smoothie" (links 7) · research "Çfarë thotë shkenca për kreatinën / What the science says about creatine" (links 10,11; cites 2 external sources) · news "SHNETA tani në Kosovë / SHNETA is live in Kosovo". FAQs (10) across categories porosia/dërgesa/pagesa/produktet/llogaria — includes "A paguaj në dorëzim? / Can I pay on delivery?" and returns policy. Pages: about, terms, privacy, shipping-returns with structured placeholder copy marked `[LEGAL: review]`. Banners: 1 home_hero (launch), 1 home_strip (free shipping over €30), 1 offers, 1 announcement ("Dërgesa falas mbi €30").

## 9. Commerce fixtures (local/staging only)

Coupons: `WELCOME10` percentage 10, min €15, per-user 1, active · `FALAS` free_shipping, min €20 · `EXPIRED5` inactive (negative tests) · hidden system `SUB-10` percentage 10. Orders for klienti@: #1 delivered 20 d ago (products 1,3 — enables review + loyalty 24 pts), #2 shipped 2 d ago (product 7), #3 pending today (product 10) — with matching payments (COD), events, shipment on #2, stock movements consistent with ledger invariant. One active subscription (product 7 · 30 d · next run +12 d). Wishlist: products 12, 14. Quiz submission sample. Newsletter: 3 confirmed subscribers. Contact message: 1 new.

## 10. Seed mechanics

`seed.sql` is idempotent (fixed UUIDs, `on conflict do update`) so `db reset` and CI are deterministic; user-dependent fixtures reference the fixed UUIDs created by `scripts/seed-users.ts` (runs first in CI). A `pnpm seed:images` step uploads `public/seed/*` to buckets (skips if present). Acceptance: after `supabase db reset` + scripts, home/PLP/PDP/admin all render fully, E2E suite passes.
