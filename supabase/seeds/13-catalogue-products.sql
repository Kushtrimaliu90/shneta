-- =============================================================================
-- Seed 13 — the launch catalogue: 39 products that fill every category
--
-- ── The problem this solves ──
--
-- Counted per category against the published catalogue:
--
--     aminoacidet 0 · karta-dhurate 0 · kolagjeni 1 · probiotiket 1 · elektrolitet 1
--     ushqime-funksionale 1 · aksesore 1 · pako 1 · mineralet 2 · omega 2 · bimore 2
--     adaptogjenet 2 · kreatina 2 · proteina 3 · vitaminat 5 · nutricion-sportiv 5
--
-- Eleven of sixteen categories had one or two products and two were empty. A shopper who taps
-- "Collagen" and finds a single item concludes the shop has nothing, and leaves — the catalogue was
-- a demo fixture set doing a launch catalogue's job.
--
-- After this: every category has at least three, most have four or five, 63 products in total. That
-- is a credible opening range for a new shop rather than an impressive one, which is the right size:
-- every SKU here is a real product that has to be really bought, stocked and photographed.
--
-- ── Prices ──
--
-- Integer cents, EUR, VAT-inclusive (CLAUDE.md §2, docs/07). Each is benchmarked against typical
-- European online retail for the same pack size, then rounded to a shelf price. They are **a
-- starting point, not a margin decision**: nobody has costed a delivery to Prishtinë or agreed a
-- landed cost with a distributor, and the owner should reprice against real invoices before trading.
-- `compare_at_price_cents` is set only where a genuine multi-pack discount exists — never as a fake
-- reference price, which is unlawful in most of Europe and cheap-looking everywhere.
--
-- ── Copy ──
--
-- Bilingual, and claim-safe (docs/08 §7): what a product *is*, in what form, at what dose. No
-- "supports immunity", no "helps you sleep". Where a claim would be lawful under Regulation
-- 432/2012 it still is not made here, because the authorised wording is specific and a lawyer
-- should choose it rather than an engineer.
--
-- ── Joins by slug, not by uuid ──
--
-- Seeds 01–02 hardcode `b0000000-…`/`c0000000-…` ids so later files can reference them. This one
-- resolves brands, categories, goals, ingredients and certifications **by slug**, because 39
-- products × five link tables is roughly 250 uuids nobody can proofread. Upserts key on the natural
-- unique columns — `products.slug`, `product_variants.sku` — so the file is idempotent without them.
--
-- ── No images ──
--
-- Same reason as seed 12: photography has to be licensed or shot. Every product here renders the
-- branded fallback tile until `pnpm seed:images` is pointed at real files. Note that migration 14
-- means a product cannot be *transitioned* into published without an image (docs/14 §8) — these are
-- inserted as published directly, which the service role is allowed to do, so the shop is browsable
-- now and the guard still applies to everything created from the admin panel afterwards.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ingredients the new products reference.
--
-- Every product links to at least one, because the ingredient pages are a real part of the
-- storefront (`/ingredients/[slug]`) and a product that references none is invisible from that side.
-- Summaries describe the substance, not an outcome.
-- -----------------------------------------------------------------------------
insert into ingredients (slug, name, other_names, summary, dosage_notes, evidence, category)
select v.slug, v.name::jsonb, v.other_names::text[], v.summary::jsonb, v.dosage::jsonb, v.evidence::evidence_level, v.category
from (values
 ('vitamin-k2','{"sq":"Vitamina K2","en":"Vitamin K2"}','{menaquinone,MK-7}',
  '{"sq":"Formë e vitaminës K e prodhuar nga fermentimi, e njohur si menakinon-7. Merret shpesh bashkë me vitaminën D3.","en":"A fermentation-derived form of vitamin K known as menaquinone-7. Commonly taken alongside vitamin D3."}',
  '{"sq":"Dozat në suplemente shkojnë nga 45 µg deri 200 µg në ditë.","en":"Supplement doses range from 45 µg to 200 µg daily."}','moderate','vitamin'),
 ('selenium','{"sq":"Selen","en":"Selenium"}','{selenomethionine}',
  '{"sq":"Mineral gjurmë; forma selenometioninë thithet mirë. Nevojat ditore matën në mikrogramë.","en":"A trace mineral; the selenomethionine form is well absorbed. Daily needs are measured in micrograms."}',
  '{"sq":"55–200 µg në ditë. Mos e kalo 400 µg pa këshillë.","en":"55–200 µg daily. Do not exceed 400 µg without advice."}','strong','mineral'),
 ('calcium','{"sq":"Kalcium","en":"Calcium"}','{"calcium carbonate","calcium citrate"}',
  '{"sq":"Minerali më i bollshëm në trup. Citrati thithet pa nevojën e acidit të stomakut; karbonati kërkon ushqim.","en":"The most abundant mineral in the body. Citrate absorbs without stomach acid; carbonate needs food."}',
  '{"sq":"Ndaje dozën në dy marrje: mbi 500 mg përnjëherë thithet më keq.","en":"Split the dose: above 500 mg at once absorbs less well."}','strong','mineral'),
 ('casein','{"sq":"Kazeinë","en":"Casein"}','{"micellar casein"}',
  '{"sq":"Proteina e dytë e qumështit, që treten ngadalë. Shumë e marrin në mbrëmje për këtë arsye.","en":"The other milk protein, slow to digest. Many take it in the evening for that reason."}',
  '{"sq":"25–40 g për porcion, sipas peshës dhe stërvitjes.","en":"25–40 g per serving, depending on body weight and training."}','strong','protein'),
 ('bcaa','{"sq":"BCAA","en":"BCAA"}','{leucine,isoleucine,valine}',
  '{"sq":"Tre aminoacide me zinxhir të degëzuar — leucinë, izoleucinë, valinë — zakonisht në raport 2:1:1.","en":"Three branched-chain amino acids — leucine, isoleucine, valine — usually in a 2:1:1 ratio."}',
  '{"sq":"5–10 g para ose pas stërvitjes.","en":"5–10 g before or after training."}','moderate','amino'),
 ('eaa','{"sq":"EAA","en":"EAA"}','{"essential amino acids"}',
  '{"sq":"Nëntë aminoacidet esenciale që trupi nuk i sintetizon. Spektri i plotë, ndryshe nga BCAA.","en":"The nine essential amino acids the body cannot make. A full spectrum, unlike BCAA."}',
  '{"sq":"10–15 g për porcion.","en":"10–15 g per serving."}','moderate','amino'),
 ('l-glutamine','{"sq":"L-Glutaminë","en":"L-Glutamine"}','{glutamine}',
  '{"sq":"Aminoacidi më i bollshëm në gjak. Pluhur pa shije, i tretshëm në ujë.","en":"The most abundant amino acid in blood. A flavourless powder, soluble in water."}',
  '{"sq":"5 g në ditë është doza e zakonshme.","en":"5 g daily is the usual dose."}','emerging','amino'),
 ('beta-alanine','{"sq":"Beta-Alaninë","en":"Beta-Alanine"}','{}',
  '{"sq":"Aminoacid jo-esencial i përdorur në stërvitje me intensitet të lartë. Shkakton shpesh një ndjesi shpimi në lëkurë, e cila është e njohur dhe kalimtare.","en":"A non-essential amino acid used in high-intensity training. Often causes a tingling sensation, which is well documented and passes."}',
  '{"sq":"3–6 g në ditë, e ndarë për të zvogëluar shpimin.","en":"3–6 g daily, split to reduce the tingling."}','moderate','amino'),
 ('ginkgo-biloba','{"sq":"Gjinko Biloba","en":"Ginkgo Biloba"}','{ginkgo}',
  '{"sq":"Ekstrakt gjethesh, standardizuar zakonisht në 24% glikozide flavone. Raporti i ekstraktit shënohet si 50:1.","en":"A leaf extract, usually standardised to 24% flavone glycosides. The extract ratio is stated as 50:1."}',
  '{"sq":"120–240 mg ekstrakt në ditë.","en":"120–240 mg of extract daily."}','moderate','herb'),
 ('milk-thistle','{"sq":"Bar mushku","en":"Milk Thistle"}','{silymarin,"Silybum marianum"}',
  '{"sq":"Ekstrakt farash i standardizuar në silimarinë, zakonisht 80%.","en":"A seed extract standardised to silymarin, usually 80%."}',
  '{"sq":"200–600 mg ekstrakt në ditë, me ushqim.","en":"200–600 mg of extract daily, with food."}','moderate','herb'),
 ('saw-palmetto','{"sq":"Sharra e palmës","en":"Saw Palmetto"}','{"Serenoa repens"}',
  '{"sq":"Ekstrakt frutash i pasur me acide yndyrore, i standardizuar zakonisht në 85–95% acide.","en":"A fatty-acid-rich berry extract, usually standardised to 85–95% fatty acids."}',
  '{"sq":"320 mg ekstrakt në ditë është doza e studiuar.","en":"320 mg of extract daily is the studied dose."}','moderate','herb'),
 ('ginseng','{"sq":"Ginseng korean","en":"Korean Ginseng"}','{"Panax ginseng",ginseng}',
  '{"sq":"Rrënjë e standardizuar në ginsenozide. Ginsengu korean (Panax) është i ndryshëm nga ai siberian.","en":"A root standardised to ginsenosides. Korean (Panax) ginseng is a different plant from Siberian."}',
  '{"sq":"200–500 mg ekstrakt në ditë, në mëngjes.","en":"200–500 mg of extract daily, in the morning."}','moderate','herb'),
 ('maca','{"sq":"Maca","en":"Maca"}','{"Lepidium meyenii"}',
  '{"sq":"Rrënjë nga Peruja, e thatë dhe e bluar në pluhur. Shitet e papërpunuar ose e gelatinizuar për tretje më të lehtë.","en":"A Peruvian root, dried and milled. Sold raw or gelatinised for easier digestion."}',
  '{"sq":"1,5–3 g pluhur në ditë.","en":"1.5–3 g of powder daily."}','traditional','herb'),
 ('cordyceps','{"sq":"Cordyceps","en":"Cordyceps"}','{"Cordyceps militaris"}',
  '{"sq":"Kërpudhë e kultivuar, e standardizuar zakonisht në beta-glukane.","en":"A cultivated mushroom, usually standardised to beta-glucans."}',
  '{"sq":"1–3 g ekstrakt në ditë.","en":"1–3 g of extract daily."}','traditional','mushroom'),
 ('spirulina','{"sq":"Spirulinë","en":"Spirulina"}','{"Arthrospira platensis"}',
  '{"sq":"Alga blu-e-gjelbër e thatë, rreth 60% proteinë sipas peshës. Shitet në tableta dhe pluhur.","en":"A dried blue-green alga, around 60% protein by weight. Sold as tablets and powder."}',
  '{"sq":"3–5 g në ditë.","en":"3–5 g daily."}','emerging','superfood'),
 ('mct-oil','{"sq":"Vaj MCT","en":"MCT Oil"}','{"medium-chain triglycerides"}',
  '{"sq":"Trigliceride me zinxhir të mesëm, të nxjerra nga arra kokosi. Të lëngshme në temperaturë dhome.","en":"Medium-chain triglycerides extracted from coconut. Liquid at room temperature."}',
  '{"sq":"Fillo me 5 ml dhe rrite gradualisht; doza të mëdha përnjëherë rëndojnë stomakun.","en":"Start at 5 ml and build up; large doses at once upset the stomach."}','moderate','fat'),
 ('caffeine','{"sq":"Kafeinë","en":"Caffeine"}','{"caffeine anhydrous"}',
  '{"sq":"Stimulant i njohur, i matur në miligramë. Një filxhan kafe ka rreth 80–100 mg.","en":"A familiar stimulant, measured in milligrams. A cup of coffee holds around 80–100 mg."}',
  '{"sq":"Mos e kalo 400 mg në ditë nga të gjitha burimet. Jo për shtatzëna dhe fëmijë.","en":"Do not exceed 400 mg daily from all sources. Not for pregnancy or children."}','strong','stimulant')
) as v(slug, name, other_names, summary, dosage, evidence, category)
on conflict (slug) do update set
  name = excluded.name, other_names = excluded.other_names, summary = excluded.summary,
  dosage_notes = excluded.dosage_notes, evidence = excluded.evidence, category = excluded.category;

/*
 * Safety notes and, where one exists, an authorised claim.
 *
 * A separate statement so the insert above stays readable, and because the two columns follow
 * different rules. `safety_notes` is factual — an interaction, an upper limit, who should not take it
 * — and belongs on every ingredient. `benefits` is where a **health claim** goes, so it is filled
 * only for the three substances with wording authorised under EU Regulation 432/2012, quoted as
 * authorised. Herbs and amino acids get none, which is the honest outcome rather than an oversight:
 * there is no authorised claim to make, and inventing one is what docs/08 §7 forbids.
 */
update ingredients set
  safety_notes = '{"sq":"Bisedo me mjekun nëse merr antikoagulantë — vitamina K ndikon në koagulim.","en":"Speak to a doctor if you take anticoagulants — vitamin K affects clotting."}'::jsonb,
  benefits = '{"sq":"Kontribuon në ruajtjen e kockave normale.","en":"Contributes to the maintenance of normal bones."}'::jsonb
where slug = 'vitamin-k2';

update ingredients set
  safety_notes = '{"sq":"Mos kalo 400 µg në ditë. Doza të tepërta janë toksike.","en":"Do not exceed 400 µg daily. Excessive doses are toxic."}'::jsonb,
  benefits = '{"sq":"Kontribuon në funksionimin normal të tiroides dhe në mbrojtjen e qelizave nga stresi oksidativ.","en":"Contributes to normal thyroid function and to the protection of cells from oxidative stress."}'::jsonb
where slug = 'selenium';

update ingredients set
  safety_notes = '{"sq":"Mund të zvogëlojë përthithjen e hekurit dhe të disa antibiotikëve; ndaji marrjet me disa orë.","en":"May reduce absorption of iron and some antibiotics; separate doses by a few hours."}'::jsonb,
  benefits = '{"sq":"Nevojitet për ruajtjen e kockave dhe dhëmbëve normalë.","en":"Is needed for the maintenance of normal bones and teeth."}'::jsonb
where slug = 'calcium';

update ingredients set safety_notes = '{"sq":"Përmban qumësht. Jo për ata me alergji ndaj proteinës së qumështit.","en":"Contains milk. Not for anyone allergic to milk protein."}'::jsonb where slug = 'casein';
update ingredients set safety_notes = '{"sq":"Të mjaftueshme nga një dietë me proteinë të përshtatshme; suplementi është zgjedhje, jo nevojë.","en":"Adequately supplied by a diet with enough protein; the supplement is a choice, not a need."}'::jsonb where slug in ('bcaa','eaa','l-glutamine');
update ingredients set safety_notes = '{"sq":"Shkakton parestezi — një ndjesi shpimi e kalimtare në lëkurë. E padëmshme dhe e pritshme.","en":"Causes paraesthesia — a passing tingling of the skin. Harmless and expected."}'::jsonb where slug = 'beta-alanine';
update ingredients set safety_notes = '{"sq":"Mund të ndërveprojë me antikoagulantë. Ndërprite dy javë para një operacioni.","en":"May interact with anticoagulants. Stop two weeks before surgery."}'::jsonb where slug = 'ginkgo-biloba';
update ingredients set safety_notes = '{"sq":"Mund të ndikojë në metabolizmin e barnave në mëlçi. Pyet farmacistin nëse merr recetë.","en":"May affect how the liver metabolises medicines. Ask a pharmacist if you take prescriptions."}'::jsonb where slug = 'milk-thistle';
update ingredients set safety_notes = '{"sq":"Nuk rekomandohet për femra shtatzëna. Mund të ndikojë në testin PSA.","en":"Not recommended in pregnancy. May affect PSA test results."}'::jsonb where slug = 'saw-palmetto';
update ingredients set safety_notes = '{"sq":"Mund të ndërveprojë me antikoagulantë dhe me barna për diabetin. Merre në mëngjes.","en":"May interact with anticoagulants and diabetes medication. Take it in the morning."}'::jsonb where slug = 'ginseng';
update ingredients set safety_notes = '{"sq":"Nuk ka të dhëna të mjaftueshme për shtatzëni dhe gjidhënie.","en":"Not enough data for pregnancy and breastfeeding."}'::jsonb where slug in ('maca','cordyceps');
update ingredients set safety_notes = '{"sq":"Zgjidh prodhues që testojnë për mikrocistina. Jo për ata me fenilketonuri.","en":"Choose producers who test for microcystins. Not for anyone with phenylketonuria."}'::jsonb where slug = 'spirulina';
update ingredients set safety_notes = '{"sq":"Doza të mëdha përnjëherë shkaktojnë çrregullime të tretjes. Fillo me pak.","en":"Large doses at once cause digestive upset. Start small."}'::jsonb where slug = 'mct-oil';
update ingredients set safety_notes = '{"sq":"Mos kalo 400 mg në ditë nga të gjitha burimet. Jo për shtatzëna, gjidhënëse dhe fëmijë.","en":"Do not exceed 400 mg daily from all sources. Not for pregnancy, breastfeeding or children."}'::jsonb where slug = 'caffeine';

-- -----------------------------------------------------------------------------
-- The products.
--
-- `is_featured` stays false on all of them: seed 01 already features four, and featuring
-- thirty-nine is featuring none.
--
-- `published_at` is staggered backwards so "newest" ordering is not one timestamp — the shop was
-- filled in an afternoon, but the ordering should still be useful.
-- -----------------------------------------------------------------------------
insert into products (slug, brand_id, name, subtitle, description, how_to_use, warnings, form, serving_size, dietary_tags, status, published_at, seo)
select v.slug, b.id, v.name::jsonb, v.subtitle::jsonb, v.description::jsonb, v.how_to_use::jsonb,
       v.warnings::jsonb, v.form::product_form, v.serving_size, v.dietary_tags::text[], 'published',
       now() - (v.age || ' days')::interval, v.seo::jsonb
from (values
 ('vitabiotics-wellman','vitabiotics',
  '{"sq":"Vitabiotics Wellman Original","en":"Vitabiotics Wellman Original"}',
  '{"sq":"30 tableta, formulë e përditshme","en":"30 tablets, daily formula"}',
  '{"sq":"Multivitaminë me 29 përbërës, e formuluar për burra nga 18 vjeç e lart. Përmban zink, selen, magnez dhe spektrin e vitaminave B.","en":"A 29-nutrient multivitamin formulated for men from 18 upwards. Contains zinc, selenium, magnesium and the B-vitamin spectrum."}',
  '{"sq":"Një tabletë në ditë me vaktin kryesor.","en":"One tablet daily with your main meal."}',
  '{"sq":"Nëse merr barna me recetë, pyet farmacistin para përdorimit.","en":"If you take prescription medicines, ask a pharmacist before use."}',
  'tablet','1 tabletë','{gluten_free}',44,
  '{"title":{"sq":"Vitabiotics Wellman Original — 30 tableta | BIOCODE","en":"Vitabiotics Wellman Original — 30 tablets | BIOCODE"},"description":{"sq":"Multivitaminë me 29 përbërës për burra. Origjinale, dërgesë në Kosovë.","en":"29-nutrient multivitamin for men. Genuine, delivered in Kosovo."}}'),
 ('vitabiotics-wellwoman','vitabiotics',
  '{"sq":"Vitabiotics Wellwoman Original","en":"Vitabiotics Wellwoman Original"}',
  '{"sq":"30 kapsula, formulë e përditshme","en":"30 capsules, daily formula"}',
  '{"sq":"Multivitaminë e formuluar për femra, me hekur, vitaminë B12, biotinë dhe vaj luleprimule.","en":"A multivitamin formulated for women, with iron, vitamin B12, biotin and evening primrose oil."}',
  '{"sq":"Një kapsulë në ditë me vaktin kryesor.","en":"One capsule daily with your main meal."}',
  '{"sq":"Përmban hekur. Mbaje larg fëmijëve.","en":"Contains iron. Keep away from children."}',
  'capsule','1 kapsulë','{gluten_free}',43,
  '{"title":{"sq":"Vitabiotics Wellwoman Original — 30 kapsula | BIOCODE","en":"Vitabiotics Wellwoman Original — 30 capsules | BIOCODE"},"description":{"sq":"Multivitaminë për femra me hekur dhe B12. Origjinale, dërgesë në Kosovë.","en":"Multivitamin for women with iron and B12. Genuine, delivered in Kosovo."}}'),
 ('now-vitamin-k2-mk7','now-foods',
  '{"sq":"NOW Vitamina K2 MK-7 100 µg","en":"NOW Vitamin K2 MK-7 100 µg"}',
  '{"sq":"60 kapsula vegjetale","en":"60 vegetable capsules"}',
  '{"sq":"Menakinon-7 nga fermentimi i natto, në kapsulë vegjetale. Merret shpesh bashkë me vitaminën D3.","en":"Menaquinone-7 from natto fermentation, in a vegetable capsule. Commonly taken alongside vitamin D3."}',
  '{"sq":"Një kapsulë në ditë me një vakt që përmban yndyrë.","en":"One capsule daily with a meal containing fat."}',
  '{"sq":"Nëse merr antikoagulantë, konsulto mjekun para përdorimit.","en":"If you take anticoagulants, consult a doctor before use."}',
  'capsule','1 kapsulë','{vegan,gluten_free,non_gmo}',42,
  '{"title":{"sq":"NOW Vitamina K2 MK-7 100 µg — 60 kapsula | BIOCODE","en":"NOW Vitamin K2 MK-7 100 µg — 60 capsules | BIOCODE"},"description":{"sq":"K2 si MK-7 nga fermentimi, vegan. Shoqëruesi i zakonshëm i D3.","en":"K2 as fermented MK-7, vegan. The usual companion to D3."}}'),
 ('now-magnesium-citrate','now-foods',
  '{"sq":"NOW Magnez Citrat 200 mg","en":"NOW Magnesium Citrate 200 mg"}',
  '{"sq":"100 tableta","en":"100 tablets"}',
  '{"sq":"Magnez i lidhur me acid citrik, forma më e përdorur dhe më e lirë për porcion. Tableta të mëdha, të ndashme.","en":"Magnesium bound to citric acid — the most widely used form and the cheapest per serving. Large, divisible tablets."}',
  '{"sq":"Dy tableta në ditë, me ushqim.","en":"Two tablets daily, with food."}',
  '{"sq":"Doza të larta mund të kenë efekt laksativ.","en":"High doses may have a laxative effect."}',
  'tablet','2 tableta','{vegan,gluten_free,non_gmo}',41,
  '{"title":{"sq":"NOW Magnez Citrat 200 mg — 100 tableta | BIOCODE","en":"NOW Magnesium Citrate 200 mg — 100 tablets | BIOCODE"},"description":{"sq":"Magnez citrat, forma klasike, çmim i mirë për porcion.","en":"Magnesium citrate, the classic form, good value per serving."}}'),
 ('lamberts-iron-bisglycinate','lamberts',
  '{"sq":"Lamberts Hekur Bisglicinat 20 mg","en":"Lamberts Iron Bisglycinate 20 mg"}',
  '{"sq":"60 tableta, formë e butë","en":"60 tablets, a gentle form"}',
  '{"sq":"Hekur i lidhur me glicinë, formë që tolerohet më mirë nga stomaku sesa sulfati. Me vitaminë C në formulë.","en":"Iron bound to glycine, a form the stomach tolerates better than sulphate. Formulated with vitamin C."}',
  '{"sq":"Një tabletë në ditë me ushqim, jo bashkë me çaj ose kafe.","en":"One tablet daily with food, not alongside tea or coffee."}',
  '{"sq":"Mbaje larg fëmijëve — mbidoza e hekurit është e rrezikshme. Merre vetëm nëse ke nevojë të konstatuar.","en":"Keep away from children — iron overdose is dangerous. Take only if a need has been established."}',
  'tablet','1 tabletë','{vegan,gluten_free}',40,
  '{"title":{"sq":"Lamberts Hekur Bisglicinat 20 mg — 60 tableta | BIOCODE","en":"Lamberts Iron Bisglycinate 20 mg — 60 tablets | BIOCODE"},"description":{"sq":"Hekur bisglicinat me vitaminë C, i butë për stomakun.","en":"Iron bisglycinate with vitamin C, gentle on the stomach."}}'),
 ('solgar-calcium-magnesium-d3','solgar',
  '{"sq":"Solgar Kalcium Magnez plus D3","en":"Solgar Calcium Magnesium plus D3"}',
  '{"sq":"150 tableta","en":"150 tablets"}',
  '{"sq":"Kalcium dhe magnez në raport 2:1 me vitaminë D3, tre përbërës që zakonisht merren bashkë.","en":"Calcium and magnesium in a 2:1 ratio with vitamin D3 — three nutrients usually taken together."}',
  '{"sq":"Tri tableta në ditë, të ndara në dy marrje me ushqim.","en":"Three tablets daily, split into two doses with food."}',
  '{"sq":"Mund të zvogëlojë përthithjen e disa antibiotikëve; ndaji marrjet me disa orë.","en":"May reduce absorption of some antibiotics; separate doses by a few hours."}',
  'tablet','3 tableta','{gluten_free}',39,
  '{"title":{"sq":"Solgar Kalcium Magnez plus D3 — 150 tableta | BIOCODE","en":"Solgar Calcium Magnesium plus D3 — 150 tablets | BIOCODE"},"description":{"sq":"Kalcium dhe magnez 2:1 me D3, në një tabletë.","en":"Calcium and magnesium 2:1 with D3, in one tablet."}}'),
 ('scitec-whey-professional','scitec-nutrition',
  '{"sq":"Scitec 100% Whey Protein Professional","en":"Scitec 100% Whey Protein Professional"}',
  '{"sq":"920 g, konsentrat me izolat","en":"920 g, concentrate with isolate"}',
  '{"sq":"Përzierje konsentrati dhe izolati me 22 g proteinë për porcion, me enzima tretjeje të shtuara. Prodhim në BE.","en":"A concentrate and isolate blend with 22 g of protein per serving and added digestive enzymes. Made in the EU."}',
  '{"sq":"Një dozë (30 g) në 300 ml ujë ose qumësht, pas stërvitjes.","en":"One scoop (30 g) in 300 ml of water or milk, after training."}',
  '{"sq":"Përmban qumësht dhe soje. Nuk zëvendëson një vakt.","en":"Contains milk and soy. Not a meal replacement."}',
  'powder','30 g','{gluten_free}',38,
  '{"title":{"sq":"Scitec 100% Whey Professional 920 g | BIOCODE","en":"Scitec 100% Whey Professional 920 g | BIOCODE"},"description":{"sq":"22 g proteinë për porcion, prodhim në BE. Çokollatë ose vanilje.","en":"22 g protein per serving, EU-made. Chocolate or vanilla."}}'),
 ('on-gold-standard-casein','optimum-nutrition',
  '{"sq":"ON Gold Standard Kazeinë","en":"ON Gold Standard Casein"}',
  '{"sq":"908 g, kazeinë micelare","en":"908 g, micellar casein"}',
  '{"sq":"Kazeinë micelare me 24 g proteinë për porcion, që treten ngadalë. Trashet më shumë se whey në ujë.","en":"Micellar casein with 24 g of protein per serving, slow to digest. Thickens more than whey in water."}',
  '{"sq":"Një dozë në 300 ml qumësht ose ujë, zakonisht në mbrëmje.","en":"One scoop in 300 ml of milk or water, usually in the evening."}',
  '{"sq":"Përmban qumësht dhe soje.","en":"Contains milk and soy."}',
  'powder','33 g','{gluten_free}',37,
  '{"title":{"sq":"ON Gold Standard Kazeinë 908 g | BIOCODE","en":"ON Gold Standard Casein 908 g | BIOCODE"},"description":{"sq":"Kazeinë micelare, 24 g proteinë, tretje e ngadaltë.","en":"Micellar casein, 24 g protein, slow digesting."}}'),
 ('biotechusa-iso-whey-zero','biotechusa',
  '{"sq":"BioTechUSA Iso Whey Zero","en":"BioTechUSA Iso Whey Zero"}',
  '{"sq":"908 g, pa laktozë e pa gluten","en":"908 g, lactose-free and gluten-free"}',
  '{"sq":"Izolat whey me 22 g proteinë për porcion, pa laktozë dhe pa sheqer të shtuar. Prodhim në BE.","en":"Whey isolate with 22 g of protein per serving, lactose-free and with no added sugar. Made in the EU."}',
  '{"sq":"Një dozë (25 g) në 250 ml ujë.","en":"One scoop (25 g) in 250 ml of water."}',
  '{"sq":"Prodhuar në një ambient që përpunon qumësht dhe soje.","en":"Made in a facility that also processes milk and soy."}',
  'powder','25 g','{gluten_free,lactose_free,sugar_free}',36,
  '{"title":{"sq":"BioTechUSA Iso Whey Zero 908 g | BIOCODE","en":"BioTechUSA Iso Whey Zero 908 g | BIOCODE"},"description":{"sq":"Izolat pa laktozë, 22 g proteinë për porcion, prodhim në BE.","en":"Lactose-free isolate, 22 g protein per serving, EU-made."}}'),
 ('scitec-creatine-monohydrate','scitec-nutrition',
  '{"sq":"Scitec Kreatinë Monohidrat","en":"Scitec Creatine Monohydrate"}',
  '{"sq":"300 g, pa aromë","en":"300 g, unflavoured"}',
  '{"sq":"Kreatinë monohidrat e pastër, pa mbushës dhe pa aromë. Njëqind porcione nga 3 g.","en":"Pure creatine monohydrate, no fillers and no flavour. One hundred 3 g servings."}',
  '{"sq":"3 g në ditë, në çdo kohë, e tretur në ujë ose lëng.","en":"3 g daily, at any time, dissolved in water or juice."}',
  '{"sq":"Pi ujë të mjaftueshëm gjatë ditës.","en":"Drink enough water through the day."}',
  'powder','3 g','{vegan,gluten_free,sugar_free}',35,
  '{"title":{"sq":"Scitec Kreatinë Monohidrat 300 g | BIOCODE","en":"Scitec Creatine Monohydrate 300 g | BIOCODE"},"description":{"sq":"Kreatinë monohidrat pa mbushës, 100 porcione.","en":"Creatine monohydrate with no fillers, 100 servings."}}'),
 ('on-bcaa-1000','optimum-nutrition',
  '{"sq":"ON BCAA 1000","en":"ON BCAA 1000"}',
  '{"sq":"200 kapsula, raport 2:1:1","en":"200 capsules, 2:1:1 ratio"}',
  '{"sq":"Leucinë, izoleucinë dhe valinë në raport 2:1:1, një gram për kapsulë. Për ata që nuk duan pluhur.","en":"Leucine, isoleucine and valine in a 2:1:1 ratio, one gram per capsule. For people who do not want powder."}',
  '{"sq":"Dy kapsula, dy herë në ditë.","en":"Two capsules, twice daily."}',
  '{"sq":"Jo për shtatzëna dhe gjidhënëse.","en":"Not for pregnancy or breastfeeding."}',
  'capsule','2 kapsula','{gluten_free}',34,
  '{"title":{"sq":"ON BCAA 1000 — 200 kapsula | BIOCODE","en":"ON BCAA 1000 — 200 capsules | BIOCODE"},"description":{"sq":"BCAA 2:1:1 në kapsula, 1 g për kapsulë.","en":"BCAA 2:1:1 in capsules, 1 g per capsule."}}'),
 ('scitec-eaa-plus-glutamine','scitec-nutrition',
  '{"sq":"Scitec EAA plus Glutaminë","en":"Scitec EAA plus Glutamine"}',
  '{"sq":"300 g, shije limoni","en":"300 g, lemon flavour"}',
  '{"sq":"Nëntë aminoacidet esenciale me L-glutaminë të shtuar. Përmbajtja e secilit aminoacid është në etiketë.","en":"All nine essential amino acids with added L-glutamine. The amount of each amino acid is on the label."}',
  '{"sq":"Një dozë (10 g) në 300 ml ujë, gjatë ose pas stërvitjes.","en":"One scoop (10 g) in 300 ml of water, during or after training."}',
  '{"sq":"Jo për shtatzëna dhe gjidhënëse.","en":"Not for pregnancy or breastfeeding."}',
  'powder','10 g','{vegan,gluten_free,sugar_free}',33,
  '{"title":{"sq":"Scitec EAA plus Glutaminë 300 g | BIOCODE","en":"Scitec EAA plus Glutamine 300 g | BIOCODE"},"description":{"sq":"Nëntë aminoacide esenciale plus glutaminë, dozë e shënuar.","en":"Nine essential amino acids plus glutamine, per-amino dosing."}}'),
 ('myprotein-l-glutamine','myprotein',
  '{"sq":"MyProtein L-Glutaminë","en":"MyProtein L-Glutamine"}',
  '{"sq":"500 g, pa aromë","en":"500 g, unflavoured"}',
  '{"sq":"L-glutaminë e pastër në pluhur, pa aromë dhe pa shtesa. Njëqind porcione nga 5 g.","en":"Pure L-glutamine powder, unflavoured and with nothing added. One hundred 5 g servings."}',
  '{"sq":"5 g në ditë, e tretur në ujë.","en":"5 g daily, dissolved in water."}',
  '{"sq":"Konsulto mjekun nëse ke sëmundje të mëlçisë ose veshkave.","en":"Consult a doctor if you have liver or kidney disease."}',
  'powder','5 g','{vegan,gluten_free,sugar_free}',32,
  '{"title":{"sq":"MyProtein L-Glutaminë 500 g | BIOCODE","en":"MyProtein L-Glutamine 500 g | BIOCODE"},"description":{"sq":"L-glutaminë e pastër, 100 porcione nga 5 g.","en":"Pure L-glutamine, one hundred 5 g servings."}}'),
 ('biotechusa-beta-alanine','biotechusa',
  '{"sq":"BioTechUSA Beta Alaninë","en":"BioTechUSA Beta Alanine"}',
  '{"sq":"300 g, pa aromë","en":"300 g, unflavoured"}',
  '{"sq":"Beta-alaninë e pastër në pluhur. Shkakton një ndjesi shpimi në lëkurë, e cila është e njohur dhe kalimtare.","en":"Pure beta-alanine powder. It causes a tingling of the skin, which is well documented and passes."}',
  '{"sq":"3 g në ditë, e ndarë në dy marrje për të zvogëluar shpimin.","en":"3 g daily, split into two doses to reduce the tingling."}',
  '{"sq":"Ndjesia e shpimit është e pritshme. Jo për shtatzëna dhe gjidhënëse.","en":"The tingling is expected. Not for pregnancy or breastfeeding."}',
  'powder','3 g','{vegan,gluten_free,sugar_free}',31,
  '{"title":{"sq":"BioTechUSA Beta Alaninë 300 g | BIOCODE","en":"BioTechUSA Beta Alanine 300 g | BIOCODE"},"description":{"sq":"Beta-alaninë e pastër, 100 porcione nga 3 g.","en":"Pure beta-alanine, one hundred 3 g servings."}}'),
 ('myprotein-the-pre-workout','myprotein',
  '{"sq":"MyProtein THE Pre-Workout","en":"MyProtein THE Pre-Workout"}',
  '{"sq":"420 g, shije mango","en":"420 g, mango flavour"}',
  '{"sq":"Para-stërvitje me 150 mg kafeinë, beta-alaninë dhe citrulinë për porcion. Përbërja e plotë është në etiketë, pa përzierje të fshehura.","en":"A pre-workout with 150 mg caffeine, beta-alanine and citrulline per serving. Full composition on the label, no proprietary blends."}',
  '{"sq":"Një dozë në 400 ml ujë, 20 minuta para stërvitjes.","en":"One scoop in 400 ml of water, 20 minutes before training."}',
  '{"sq":"Përmban kafeinë. Jo për shtatzëna, gjidhënëse, fëmijë ose të ndjeshëm ndaj kafeinës. Mos e merr në mbrëmje.","en":"Contains caffeine. Not for pregnancy, breastfeeding, children or anyone sensitive to caffeine. Avoid in the evening."}',
  'powder','14 g','{vegan,gluten_free}',30,
  '{"title":{"sq":"MyProtein THE Pre-Workout 420 g | BIOCODE","en":"MyProtein THE Pre-Workout 420 g | BIOCODE"},"description":{"sq":"150 mg kafeinë, beta-alaninë dhe citrulinë, dozë e shënuar.","en":"150 mg caffeine, beta-alanine and citrulline, fully dosed."}}'),
 ('nordic-naturals-ultimate-omega','nordic-naturals',
  '{"sq":"Nordic Naturals Ultimate Omega","en":"Nordic Naturals Ultimate Omega"}',
  '{"sq":"60 softgel, shije limoni","en":"60 softgels, lemon flavour"}',
  '{"sq":"1280 mg omega-3 total për porcion, me 650 mg EPA dhe 450 mg DHA. Në formë trigliceride, me limon natyral për shijen.","en":"1280 mg of total omega-3 per serving, with 650 mg EPA and 450 mg DHA. In triglyceride form, with natural lemon for taste."}',
  '{"sq":"Dy softgel në ditë me një vakt.","en":"Two softgels daily with a meal."}',
  '{"sq":"Përmban peshk. Nëse merr antikoagulantë, konsulto mjekun.","en":"Contains fish. If you take anticoagulants, consult a doctor."}',
  'softgel','2 softgel','{gluten_free,non_gmo}',29,
  '{"title":{"sq":"Nordic Naturals Ultimate Omega — 60 softgel | BIOCODE","en":"Nordic Naturals Ultimate Omega — 60 softgels | BIOCODE"},"description":{"sq":"650 mg EPA dhe 450 mg DHA për porcion, formë trigliceride.","en":"650 mg EPA and 450 mg DHA per serving, triglyceride form."}}'),
 ('nordic-naturals-algae-omega','nordic-naturals',
  '{"sq":"Nordic Naturals Algae Omega","en":"Nordic Naturals Algae Omega"}',
  '{"sq":"60 softgel, vegan","en":"60 softgels, vegan"}',
  '{"sq":"Omega-3 nga algat, pa peshk: 715 mg total për porcion me EPA dhe DHA. E njëjta rrugë nga e cila peshqit e marrin.","en":"Omega-3 from algae, no fish: 715 mg total per serving with EPA and DHA. The same source fish get it from."}',
  '{"sq":"Dy softgel në ditë me një vakt.","en":"Two softgels daily with a meal."}',
  '{"sq":"Nëse merr antikoagulantë, konsulto mjekun.","en":"If you take anticoagulants, consult a doctor."}',
  'softgel','2 softgel','{vegan,gluten_free,non_gmo}',28,
  '{"title":{"sq":"Nordic Naturals Algae Omega vegan — 60 softgel | BIOCODE","en":"Nordic Naturals Algae Omega vegan — 60 softgels | BIOCODE"},"description":{"sq":"Omega-3 vegan nga algat, me EPA dhe DHA të shënuara.","en":"Vegan algal omega-3 with EPA and DHA stated."}}'),
 ('now-cod-liver-oil','now-foods',
  '{"sq":"NOW Vaj Mëlçie Merluci 1000 mg","en":"NOW Cod Liver Oil 1000 mg"}',
  '{"sq":"180 softgel","en":"180 softgels"}',
  '{"sq":"Vaj mëlçie merluci me vitaminë A dhe D të natyrshme, plus EPA dhe DHA. Burim tradicional, çmim i arsyeshëm për porcion.","en":"Cod liver oil with naturally occurring vitamins A and D, plus EPA and DHA. A traditional source at a sensible cost per serving."}',
  '{"sq":"Dy softgel në ditë me ushqim.","en":"Two softgels daily with food."}',
  '{"sq":"Përmban peshk dhe vitaminë A. Jo për shtatzëna pa këshillë mjekësore.","en":"Contains fish and vitamin A. Not for pregnancy without medical advice."}',
  'softgel','2 softgel','{gluten_free,non_gmo}',27,
  '{"title":{"sq":"NOW Vaj Mëlçie Merluci 1000 mg — 180 softgel | BIOCODE","en":"NOW Cod Liver Oil 1000 mg — 180 softgels | BIOCODE"},"description":{"sq":"Vaj mëlçie merluci me vitaminë A dhe D natyrale.","en":"Cod liver oil with naturally occurring vitamins A and D."}}'),
 ('now-collagen-peptides','now-foods',
  '{"sq":"NOW Peptide Kolagjeni","en":"NOW Collagen Peptides"}',
  '{"sq":"227 g pluhur, pa aromë","en":"227 g powder, unflavoured"}',
  '{"sq":"Peptide kolagjeni bovine të hidrolizuara, tip I dhe III, 10 g për porcion. Treten në pije të ftohta pa u mpiksur.","en":"Hydrolysed bovine collagen peptides, type I and III, 10 g per serving. Dissolve in cold drinks without clumping."}',
  '{"sq":"Një dozë (10 g) në kafe, çaj ose smoothie.","en":"One scoop (10 g) in coffee, tea or a smoothie."}',
  '{"sq":"Burim bovin. Jo i përshtatshëm për vegjetarianë.","en":"Bovine source. Not suitable for vegetarians."}',
  'powder','10 g','{gluten_free,non_gmo}',26,
  '{"title":{"sq":"NOW Peptide Kolagjeni 227 g | BIOCODE","en":"NOW Collagen Peptides 227 g | BIOCODE"},"description":{"sq":"Peptide kolagjeni tip I dhe III, 10 g për porcion, pa aromë.","en":"Type I and III collagen peptides, 10 g per serving, unflavoured."}}'),
 ('garden-of-life-collagen-beauty','garden-of-life',
  '{"sq":"Garden of Life Collagen Beauty","en":"Garden of Life Collagen Beauty"}',
  '{"sq":"270 g, shije berry","en":"270 g, berry flavour"}',
  '{"sq":"Peptide kolagjeni nga bagëti të kullotur, me biotinë, vitaminë C dhe silicë nga bambu. Me probiotikë të shtuar.","en":"Collagen peptides from grass-fed cattle, with biotin, vitamin C and bamboo silica. With added probiotics."}',
  '{"sq":"Një dozë në 250 ml ujë ose smoothie, një herë në ditë.","en":"One scoop in 250 ml of water or a smoothie, once daily."}',
  '{"sq":"Burim bovin. Jo i përshtatshëm për vegjetarianë.","en":"Bovine source. Not suitable for vegetarians."}',
  'powder','18 g','{gluten_free,non_gmo}',25,
  '{"title":{"sq":"Garden of Life Collagen Beauty 270 g | BIOCODE","en":"Garden of Life Collagen Beauty 270 g | BIOCODE"},"description":{"sq":"Kolagjen nga bagëti të kullotur, me biotinë dhe vitaminë C.","en":"Grass-fed collagen with biotin and vitamin C."}}'),
 ('solgar-collagen-hyaluronic','solgar',
  '{"sq":"Solgar Kolagjen Acid Hialuronik","en":"Solgar Collagen Hyaluronic Acid"}',
  '{"sq":"30 tableta","en":"30 tablets"}',
  '{"sq":"Acid hialuronik me kolagjen tip II të hidrolizuar dhe vitaminë C, në tabletë. Për ata që preferojnë tableta ndaj pluhurit.","en":"Hyaluronic acid with hydrolysed type II collagen and vitamin C, as a tablet. For people who prefer tablets to powder."}',
  '{"sq":"Një tabletë në ditë me ushqim.","en":"One tablet daily with food."}',
  '{"sq":"Përmban kolagjen nga pulë. Jo i përshtatshëm për vegjetarianë.","en":"Contains chicken-derived collagen. Not suitable for vegetarians."}',
  'tablet','1 tabletë','{gluten_free}',24,
  '{"title":{"sq":"Solgar Kolagjen Acid Hialuronik — 30 tableta | BIOCODE","en":"Solgar Collagen Hyaluronic Acid — 30 tablets | BIOCODE"},"description":{"sq":"Acid hialuronik me kolagjen tip II dhe vitaminë C, në tabletë.","en":"Hyaluronic acid with type II collagen and vitamin C, in tablet form."}}'),
 ('lamberts-ginkgo-biloba','lamberts',
  '{"sq":"Lamberts Gjinko Biloba 6000 mg","en":"Lamberts Ginkgo Biloba 6000 mg"}',
  '{"sq":"60 tableta, ekstrakt 50:1","en":"60 tablets, 50:1 extract"}',
  '{"sq":"Ekstrakt gjethesh 50:1, i standardizuar në 24% glikozide flavone — 120 mg ekstrakt që i përgjigjet 6000 mg gjetheve.","en":"A 50:1 leaf extract standardised to 24% flavone glycosides — 120 mg of extract equivalent to 6000 mg of leaf."}',
  '{"sq":"Një tabletë në ditë me ushqim.","en":"One tablet daily with food."}',
  '{"sq":"Mund të ndërveprojë me antikoagulantë. Ndërprite dy javë para një operacioni.","en":"May interact with anticoagulants. Stop two weeks before surgery."}',
  'tablet','1 tabletë','{vegan,gluten_free}',23,
  '{"title":{"sq":"Lamberts Gjinko Biloba 6000 mg — 60 tableta | BIOCODE","en":"Lamberts Ginkgo Biloba 6000 mg — 60 tablets | BIOCODE"},"description":{"sq":"Ekstrakt 50:1 standardizuar në 24% glikozide flavone.","en":"A 50:1 extract standardised to 24% flavone glycosides."}}'),
 ('now-milk-thistle','now-foods',
  '{"sq":"NOW Bar Mushku 300 mg","en":"NOW Milk Thistle 300 mg"}',
  '{"sq":"100 kapsula vegjetale","en":"100 vegetable capsules"}',
  '{"sq":"Ekstrakt farash i standardizuar në 80% silimarinë, me turmerik të shtuar. Kapsulë vegjetale.","en":"A seed extract standardised to 80% silymarin, with added turmeric. Vegetable capsule."}',
  '{"sq":"Një kapsulë, dy herë në ditë me ushqim.","en":"One capsule twice daily with food."}',
  '{"sq":"Mund të ndikojë në metabolizmin e barnave në mëlçi. Pyet farmacistin nëse merr recetë.","en":"May affect how the liver metabolises medicines. Ask a pharmacist if you take prescriptions."}',
  'capsule','1 kapsulë','{vegan,gluten_free,non_gmo}',22,
  '{"title":{"sq":"NOW Bar Mushku 300 mg — 100 kapsula | BIOCODE","en":"NOW Milk Thistle 300 mg — 100 capsules | BIOCODE"},"description":{"sq":"Ekstrakt i standardizuar në 80% silimarinë, vegan.","en":"Extract standardised to 80% silymarin, vegan."}}'),
 ('now-saw-palmetto','now-foods',
  '{"sq":"NOW Sharra e Palmës 320 mg","en":"NOW Saw Palmetto 320 mg"}',
  '{"sq":"90 softgel","en":"90 softgels"}',
  '{"sq":"Ekstrakt frutash i standardizuar në 85% acide yndyrore, në dozën 320 mg që përdorin studimet.","en":"A berry extract standardised to 85% fatty acids, at the 320 mg dose used in studies."}',
  '{"sq":"Një softgel në ditë me ushqim.","en":"One softgel daily with food."}',
  '{"sq":"Jo për femra shtatzëna. Mund të ndikojë në rezultatin e testit PSA — thuaje mjekut nëse e merr.","en":"Not for pregnancy. May affect PSA test results — tell your doctor if you take it."}',
  'softgel','1 softgel','{gluten_free,non_gmo}',21,
  '{"title":{"sq":"NOW Sharra e Palmës 320 mg — 90 softgel | BIOCODE","en":"NOW Saw Palmetto 320 mg — 90 softgels | BIOCODE"},"description":{"sq":"Ekstrakt 85% acide yndyrore, doza 320 mg e studiuar.","en":"85% fatty acid extract at the studied 320 mg dose."}}'),
 ('now-korean-ginseng','now-foods',
  '{"sq":"NOW Ginseng Korean 500 mg","en":"NOW Korean Ginseng 500 mg"}',
  '{"sq":"100 kapsula vegjetale","en":"100 vegetable capsules"}',
  '{"sq":"Rrënjë Panax ginseng e standardizuar në 1,5% ginsenozide. Ginsengu korean, i ndryshëm nga ai siberian.","en":"Panax ginseng root standardised to 1.5% ginsenosides. Korean ginseng, a different plant from Siberian."}',
  '{"sq":"Një kapsulë në ditë, në mëngjes.","en":"One capsule daily, in the morning."}',
  '{"sq":"Mund të ndërveprojë me antikoagulantë dhe barna për diabetin. Jo në mbrëmje.","en":"May interact with anticoagulants and diabetes medication. Not in the evening."}',
  'capsule','1 kapsulë','{vegan,gluten_free,non_gmo}',20,
  '{"title":{"sq":"NOW Ginseng Korean 500 mg — 100 kapsula | BIOCODE","en":"NOW Korean Ginseng 500 mg — 100 capsules | BIOCODE"},"description":{"sq":"Panax ginseng i standardizuar në 1,5% ginsenozide.","en":"Panax ginseng standardised to 1.5% ginsenosides."}}'),
 ('now-maca-500','now-foods',
  '{"sq":"NOW Maca 500 mg","en":"NOW Maca 500 mg"}',
  '{"sq":"100 kapsula vegjetale","en":"100 vegetable capsules"}',
  '{"sq":"Rrënjë maca nga Peruja, e bluar dhe e paketuar në kapsulë vegjetale, pa ekstraktim.","en":"Peruvian maca root, milled and packed into a vegetable capsule, unextracted."}',
  '{"sq":"Një kapsulë, dy herë në ditë me ushqim.","en":"One capsule twice daily with food."}',
  '{"sq":"Nuk ka të dhëna të mjaftueshme për shtatzëni dhe gjidhënie.","en":"Not enough data for pregnancy and breastfeeding."}',
  'capsule','1 kapsulë','{vegan,gluten_free,non_gmo}',19,
  '{"title":{"sq":"NOW Maca 500 mg — 100 kapsula | BIOCODE","en":"NOW Maca 500 mg — 100 capsules | BIOCODE"},"description":{"sq":"Rrënjë maca nga Peruja në kapsulë vegjetale.","en":"Peruvian maca root in a vegetable capsule."}}'),
 ('now-cordyceps-750','now-foods',
  '{"sq":"NOW Cordyceps 750 mg","en":"NOW Cordyceps 750 mg"}',
  '{"sq":"90 kapsula vegjetale","en":"90 vegetable capsules"}',
  '{"sq":"Kërpudhë Cordyceps militaris e kultivuar, e standardizuar në beta-glukane. Kapsulë vegjetale.","en":"Cultivated Cordyceps militaris standardised to beta-glucans. Vegetable capsule."}',
  '{"sq":"Një kapsulë, dy herë në ditë me ushqim.","en":"One capsule twice daily with food."}',
  '{"sq":"Nuk ka të dhëna të mjaftueshme për shtatzëni dhe gjidhënie.","en":"Not enough data for pregnancy and breastfeeding."}',
  'capsule','1 kapsulë','{vegan,gluten_free,non_gmo}',18,
  '{"title":{"sq":"NOW Cordyceps 750 mg — 90 kapsula | BIOCODE","en":"NOW Cordyceps 750 mg — 90 capsules | BIOCODE"},"description":{"sq":"Cordyceps militaris i kultivuar, i standardizuar në beta-glukane.","en":"Cultivated Cordyceps militaris standardised to beta-glucans."}}'),
 ('garden-of-life-probiotics-50b','garden-of-life',
  '{"sq":"Garden of Life Probiotikë 50 miliardë","en":"Garden of Life Probiotics 50 Billion"}',
  '{"sq":"30 kapsula, 16 shtame","en":"30 capsules, 16 strains"}',
  '{"sq":"Gjashtëmbëdhjetë shtame të emërtuara me 50 miliardë CFU të garantuara në datën e skadencës, jo në prodhim. Qëndrueshëm në raft.","en":"Sixteen named strains with 50 billion CFU guaranteed at expiry, not at manufacture. Shelf-stable."}',
  '{"sq":"Një kapsulë në ditë, me ose pa ushqim.","en":"One capsule daily, with or without food."}',
  '{"sq":"Nëse ke sistem imunitar të kompromentuar, konsulto mjekun para përdorimit.","en":"If you are immunocompromised, consult a doctor before use."}',
  'capsule','1 kapsulë','{vegan,gluten_free,non_gmo}',17,
  '{"title":{"sq":"Garden of Life Probiotikë 50 miliardë — 30 kapsula | BIOCODE","en":"Garden of Life Probiotics 50 Billion — 30 capsules | BIOCODE"},"description":{"sq":"16 shtame, 50 miliardë CFU në skadencë, qëndrueshëm në raft.","en":"16 strains, 50 billion CFU at expiry, shelf-stable."}}'),
 ('now-probiotic-10-25b','now-foods',
  '{"sq":"NOW Probiotic-10 25 miliardë","en":"NOW Probiotic-10 25 Billion"}',
  '{"sq":"50 kapsula vegjetale, 10 shtame","en":"50 vegetable capsules, 10 strains"}',
  '{"sq":"Dhjetë shtame me 25 miliardë CFU për kapsulë, të përzgjedhura nga gjinitë Lactobacillus dhe Bifidobacterium.","en":"Ten strains with 25 billion CFU per capsule, selected from the Lactobacillus and Bifidobacterium genera."}',
  '{"sq":"Një kapsulë në ditë me stomak bosh.","en":"One capsule daily on an empty stomach."}',
  '{"sq":"Mbaje në frigorifer për të ruajtur numrin e CFU-ve.","en":"Refrigerate to preserve the CFU count."}',
  'capsule','1 kapsulë','{vegan,gluten_free,non_gmo}',16,
  '{"title":{"sq":"NOW Probiotic-10 25 miliardë — 50 kapsula | BIOCODE","en":"NOW Probiotic-10 25 Billion — 50 capsules | BIOCODE"},"description":{"sq":"Dhjetë shtame, 25 miliardë CFU për kapsulë, vegan.","en":"Ten strains, 25 billion CFU per capsule, vegan."}}'),
 ('garden-of-life-womens-probiotic','garden-of-life',
  '{"sq":"Garden of Life Probiotikë për Femra","en":"Garden of Life Womens Probiotic"}',
  '{"sq":"30 kapsula, 50 miliardë CFU","en":"30 capsules, 50 billion CFU"}',
  '{"sq":"Formulë me shtame Lactobacillus të zgjedhura, me prebiotikë dhe boronicë të shtuar. 50 miliardë CFU në skadencë.","en":"A formula with selected Lactobacillus strains, plus prebiotics and added cranberry. 50 billion CFU at expiry."}',
  '{"sq":"Një kapsulë në ditë.","en":"One capsule daily."}',
  '{"sq":"Nëse ke sistem imunitar të kompromentuar, konsulto mjekun para përdorimit.","en":"If you are immunocompromised, consult a doctor before use."}',
  'capsule','1 kapsulë','{vegan,gluten_free,non_gmo}',15,
  '{"title":{"sq":"Garden of Life Probiotikë për Femra — 30 kapsula | BIOCODE","en":"Garden of Life Womens Probiotic — 30 capsules | BIOCODE"},"description":{"sq":"Shtame Lactobacillus me prebiotikë dhe boronicë, 50 miliardë CFU.","en":"Lactobacillus strains with prebiotics and cranberry, 50 billion CFU."}}'),
 ('myprotein-hydration-powder','myprotein',
  '{"sq":"MyProtein Pluhur Hidratimi","en":"MyProtein Hydration Powder"}',
  '{"sq":"500 g, shije portokall","en":"500 g, orange flavour"}',
  '{"sq":"Natrium, kalium dhe magnez me karbohidrate për thithje më të shpejtë të ujit. Për stërvitje mbi një orë.","en":"Sodium, potassium and magnesium with carbohydrate for faster water uptake. For sessions over an hour."}',
  '{"sq":"Një dozë (25 g) në 500 ml ujë, gjatë stërvitjes.","en":"One scoop (25 g) in 500 ml of water, during training."}',
  '{"sq":"Përmban natrium dhe sheqer. Jo për dietë pa natrium.","en":"Contains sodium and sugar. Not for a sodium-restricted diet."}',
  'powder','25 g','{vegan,gluten_free}',14,
  '{"title":{"sq":"MyProtein Pluhur Hidratimi 500 g | BIOCODE","en":"MyProtein Hydration Powder 500 g | BIOCODE"},"description":{"sq":"Elektrolitë me karbohidrate për stërvitje të gjata.","en":"Electrolytes with carbohydrate for long sessions."}}'),
 ('biotechusa-mineral-complex','biotechusa',
  '{"sq":"BioTechUSA Kompleks Mineral","en":"BioTechUSA Mineral Complex"}',
  '{"sq":"100 tableta","en":"100 tablets"}',
  '{"sq":"Magnez, kalcium, zink, kalium dhe selen në një tabletë. Alternativë pa sheqer ndaj pluhurave.","en":"Magnesium, calcium, zinc, potassium and selenium in one tablet. A sugar-free alternative to powders."}',
  '{"sq":"Dy tableta në ditë me ushqim.","en":"Two tablets daily with food."}',
  '{"sq":"Mos e kalo dozën e rekomanduar.","en":"Do not exceed the recommended dose."}',
  'tablet','2 tableta','{gluten_free,sugar_free}',13,
  '{"title":{"sq":"BioTechUSA Kompleks Mineral — 100 tableta | BIOCODE","en":"BioTechUSA Mineral Complex — 100 tablets | BIOCODE"},"description":{"sq":"Pesë minerale në një tabletë, pa sheqer.","en":"Five minerals in one tablet, sugar-free."}}'),
 ('garden-of-life-perfect-food-greens','garden-of-life',
  '{"sq":"Garden of Life Perfect Food Greens","en":"Garden of Life Perfect Food Greens"}',
  '{"sq":"240 g pluhur, organik","en":"240 g powder, organic"}',
  '{"sq":"Pluhur i gjelbër nga bimë të mbjella organikisht — grurë i gjelbër, elb, spirulinë dhe perime. Përbërja e plotë është në etiketë.","en":"A greens powder from organically grown plants — wheatgrass, barley, spirulina and vegetables. Full composition on the label."}',
  '{"sq":"Një dozë në 300 ml ujë ose lëng, një herë në ditë.","en":"One scoop in 300 ml of water or juice, once daily."}',
  '{"sq":"Nëse merr antikoagulantë, përmbajtja e vitaminës K është e rëndësishme — pyet mjekun.","en":"If you take anticoagulants, the vitamin K content matters — ask your doctor."}',
  'powder','10 g','{vegan,gluten_free,non_gmo}',12,
  '{"title":{"sq":"Garden of Life Perfect Food Greens 240 g | BIOCODE","en":"Garden of Life Perfect Food Greens 240 g | BIOCODE"},"description":{"sq":"Pluhur i gjelbër organik me spirulinë dhe perime.","en":"Organic greens powder with spirulina and vegetables."}}'),
 ('now-mct-oil','now-foods',
  '{"sq":"NOW Vaj MCT","en":"NOW MCT Oil"}',
  '{"sq":"473 ml, pa aromë","en":"473 ml, unflavoured"}',
  '{"sq":"Trigliceride me zinxhir të mesëm nga arra kokosi, të lëngshme dhe pa shije. Për kafe, salca ose smoothie.","en":"Medium-chain triglycerides from coconut, liquid and tasteless. For coffee, dressings or smoothies."}',
  '{"sq":"Fillo me 5 ml në ditë dhe rrite gradualisht deri në 15 ml.","en":"Start at 5 ml daily and build up to 15 ml."}',
  '{"sq":"Doza të mëdha përnjëherë shkaktojnë çrregullime të tretjes. Mos e nxeh në temperaturë të lartë.","en":"Large doses at once cause digestive upset. Do not heat to high temperatures."}',
  'liquid','15 ml','{vegan,gluten_free,non_gmo}',11,
  '{"title":{"sq":"NOW Vaj MCT 473 ml | BIOCODE","en":"NOW MCT Oil 473 ml | BIOCODE"},"description":{"sq":"Vaj MCT nga kokosi, pa shije, për kafe dhe smoothie.","en":"Coconut MCT oil, tasteless, for coffee and smoothies."}}'),
 ('now-spirulina-500','now-foods',
  '{"sq":"NOW Spirulinë 500 mg","en":"NOW Spirulina 500 mg"}',
  '{"sq":"200 tableta, organike","en":"200 tablets, organic"}',
  '{"sq":"Spirulinë organike e certifikuar, rreth 60% proteinë sipas peshës. Tableta të vogla, të lehta për gëlltitje.","en":"Certified organic spirulina, around 60% protein by weight. Small tablets, easy to swallow."}',
  '{"sq":"Tri tableta, dy herë në ditë me ushqim.","en":"Three tablets twice daily with food."}',
  '{"sq":"Jo për ata me fenilketonuri. Zgjidh gjithmonë prodhues që testojnë për mikrocistina.","en":"Not for anyone with phenylketonuria. Always choose producers who test for microcystins."}',
  'tablet','3 tableta','{vegan,gluten_free,non_gmo}',10,
  '{"title":{"sq":"NOW Spirulinë organike 500 mg — 200 tableta | BIOCODE","en":"NOW Organic Spirulina 500 mg — 200 tablets | BIOCODE"},"description":{"sq":"Spirulinë organike e certifikuar, 60% proteinë sipas peshës.","en":"Certified organic spirulina, 60% protein by weight."}}'),
 ('biocode-pill-organiser','biocode',
  '{"sq":"BIOCODE Kuti Dozimi 7 Ditore","en":"BIOCODE 7-Day Pill Organiser"}',
  '{"sq":"Shtatë ndarje, pa BPA","en":"Seven compartments, BPA-free"}',
  '{"sq":"Shtatë ndarje të ndashme, një për ditë, me kapak që mbyll me klikim. Hyn në xhep ose në çantë.","en":"Seven detachable compartments, one per day, with lids that click shut. Fits a pocket or a bag."}',
  '{"sq":"Lahet me dorë me ujë të ngrohtë.","en":"Hand wash in warm water."}',
  '{"sq":"Mbaje larg fëmijëve nëse përmban barna.","en":"Keep away from children if it holds medicines."}',
  'other',null,'{}',9,
  '{"title":{"sq":"BIOCODE Kuti Dozimi 7 Ditore","en":"BIOCODE 7-Day Pill Organiser"},"description":{"sq":"Kuti dozimi shtatë-ditore, pa BPA, me ndarje të ndashme.","en":"Seven-day pill organiser, BPA-free, with detachable compartments."}}'),
 ('biocode-bottle-750','biocode',
  '{"sq":"BIOCODE Shishe 750 ml","en":"BIOCODE Bottle 750 ml"}',
  '{"sq":"Pa BPA, me shkallë matëse","en":"BPA-free, with measurement markings"}',
  '{"sq":"Shishe 750 ml pa BPA me shkallë matëse dhe kapak që nuk pikon. Hyn në mbajtësin e shisheve të makinës.","en":"A 750 ml BPA-free bottle with measurement markings and a lid that does not leak. Fits a car cup holder."}',
  '{"sq":"Lahet me dorë. Jo për pije të nxehta.","en":"Hand wash. Not for hot drinks."}',
  '{}','other',null,'{}',8,
  '{"title":{"sq":"BIOCODE Shishe 750 ml","en":"BIOCODE Bottle 750 ml"},"description":{"sq":"Shishe 750 ml pa BPA, me shkallë matëse.","en":"A 750 ml BPA-free bottle with measurement markings."}}'),
 ('pako-gjumi','biocode',
  '{"sq":"Pako Gjumi","en":"Sleep Bundle"}',
  '{"sq":"Magnez bisglicinat dhe melatoninë","en":"Magnesium bisglycinate and melatonin"}',
  '{"sq":"Magnez bisglicinat Solgar dhe melatoninë Jamieson 3 mg në një pako. Dy produktet që merren më shpesh bashkë në mbrëmje, me çmim më të lirë sesa veç.","en":"Solgar magnesium bisglycinate and Jamieson melatonin 3 mg in one pack. The two most commonly paired evening products, cheaper than buying them separately."}',
  '{"sq":"Ndiq udhëzimet e secilit produkt brenda pakos.","en":"Follow the directions on each product in the pack."}',
  '{"sq":"Melatonina nuk rekomandohet për shtatzëna, gjidhënëse dhe nën 18 vjeç.","en":"Melatonin is not recommended in pregnancy, breastfeeding or under 18."}',
  'other','1 set','{gluten_free}',7,
  '{"title":{"sq":"Pako Gjumi — magnez dhe melatoninë | BIOCODE","en":"Sleep Bundle — magnesium and melatonin | BIOCODE"},"description":{"sq":"Magnez bisglicinat dhe melatoninë 3 mg, me çmim pakoje.","en":"Magnesium bisglycinate and 3 mg melatonin at a bundle price."}}'),
 ('pako-stervitje','biocode',
  '{"sq":"Pako Fillestare e Stërvitjes","en":"Training Starter Bundle"}',
  '{"sq":"Whey, kreatinë dhe shaker","en":"Whey, creatine and a shaker"}',
  '{"sq":"Whey MyProtein Impact 1 kg, kreatinë monohidrat Scitec 300 g dhe një shaker BIOCODE 600 ml — gjithçka që i duhet një fillestari, në një porosi.","en":"MyProtein Impact Whey 1 kg, Scitec creatine monohydrate 300 g and a BIOCODE 600 ml shaker — everything a beginner needs, in one order."}',
  '{"sq":"Ndiq udhëzimet e secilit produkt brenda pakos.","en":"Follow the directions on each product in the pack."}',
  '{"sq":"Përmban qumësht dhe soje.","en":"Contains milk and soy."}',
  'other','1 set','{gluten_free}',6,
  '{"title":{"sq":"Pako Fillestare e Stërvitjes | BIOCODE","en":"Training Starter Bundle | BIOCODE"},"description":{"sq":"Whey 1 kg, kreatinë 300 g dhe shaker, me çmim pakoje.","en":"1 kg whey, 300 g creatine and a shaker at a bundle price."}}')
) as v(slug, brand_slug, name, subtitle, description, how_to_use, warnings, form, serving_size, dietary_tags, age, seo)
join brands b on b.slug = v.brand_slug
on conflict (slug) do update set
  brand_id = excluded.brand_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, how_to_use = excluded.how_to_use, warnings = excluded.warnings,
  form = excluded.form, serving_size = excluded.serving_size, dietary_tags = excluded.dietary_tags,
  seo = excluded.seo;

-- -----------------------------------------------------------------------------
-- Variants. Integer cents, EUR, VAT-inclusive.
--
-- Two flavours where the flavour genuinely changes the SKU and one where it does not: a merchant
-- shipping "chocolate or vanilla" as one line item cannot pick from a warehouse.
--
-- `compare_at_price_cents` appears on the two bundles only, and each is checked against the sum of
-- its parts below. A compare-at price that is not a price something was actually sold at is unlawful
-- in most of Europe.
-- -----------------------------------------------------------------------------
insert into product_variants (product_id, sku, name, options, price_cents, compare_at_price_cents, is_default, position)
select p.id, v.sku, v.name::jsonb, v.options::jsonb, v.price, v.compare_at, v.is_default, v.position
from (values
 ('vitabiotics-wellman','VB-WM-30','{"sq":"30 tableta","en":"30 tablets"}','{"count":"30"}',1490,null,true,0),
 ('vitabiotics-wellwoman','VB-WW-30','{"sq":"30 kapsula","en":"30 capsules"}','{"count":"30"}',1490,null,true,0),
 ('now-vitamin-k2-mk7','NOW-K2-60','{"sq":"60 kapsula","en":"60 capsules"}','{"count":"60"}',1390,null,true,0),
 ('now-magnesium-citrate','NOW-MGC-100','{"sq":"100 tableta","en":"100 tablets"}','{"count":"100"}',1290,null,true,0),
 ('lamberts-iron-bisglycinate','LAM-FE-60','{"sq":"60 tableta","en":"60 tablets"}','{"count":"60"}',1190,null,true,0),
 ('solgar-calcium-magnesium-d3','SOL-CAMG-150','{"sq":"150 tableta","en":"150 tablets"}','{"count":"150"}',1790,null,true,0),
 ('scitec-whey-professional','SCI-WPP-920-CHOC','{"sq":"920 g çokollatë","en":"920 g chocolate"}','{"size":"920g","flavor":"chocolate"}',2990,null,true,0),
 ('scitec-whey-professional','SCI-WPP-920-VAN','{"sq":"920 g vanilje","en":"920 g vanilla"}','{"size":"920g","flavor":"vanilla"}',2990,null,false,1),
 ('on-gold-standard-casein','ON-CAS-908','{"sq":"908 g çokollatë","en":"908 g chocolate"}','{"size":"908g","flavor":"chocolate"}',4190,null,true,0),
 ('biotechusa-iso-whey-zero','BTU-IWZ-908-CHOC','{"sq":"908 g çokollatë","en":"908 g chocolate"}','{"size":"908g","flavor":"chocolate"}',3690,null,true,0),
 ('biotechusa-iso-whey-zero','BTU-IWZ-908-VAN','{"sq":"908 g vanilje","en":"908 g vanilla"}','{"size":"908g","flavor":"vanilla"}',3690,null,false,1),
 ('scitec-creatine-monohydrate','SCI-CRE-300','{"sq":"300 g","en":"300 g"}','{"size":"300g"}',1490,null,true,0),
 ('on-bcaa-1000','ON-BCAA-200','{"sq":"200 kapsula","en":"200 capsules"}','{"count":"200"}',2690,null,true,0),
 ('scitec-eaa-plus-glutamine','SCI-EAA-300','{"sq":"300 g limon","en":"300 g lemon"}','{"size":"300g","flavor":"lemon"}',2290,null,true,0),
 ('myprotein-l-glutamine','MP-GLU-500','{"sq":"500 g","en":"500 g"}','{"size":"500g"}',1690,null,true,0),
 ('biotechusa-beta-alanine','BTU-BA-300','{"sq":"300 g","en":"300 g"}','{"size":"300g"}',1790,null,true,0),
 ('myprotein-the-pre-workout','MP-PRE-420','{"sq":"420 g mango","en":"420 g mango"}','{"size":"420g","flavor":"mango"}',2690,null,true,0),
 ('nordic-naturals-ultimate-omega','NN-UO-60','{"sq":"60 softgel","en":"60 softgels"}','{"count":"60"}',3190,null,true,0),
 ('nordic-naturals-algae-omega','NN-AO-60','{"sq":"60 softgel","en":"60 softgels"}','{"count":"60"}',2990,null,true,0),
 ('now-cod-liver-oil','NOW-CLO-180','{"sq":"180 softgel","en":"180 softgels"}','{"count":"180"}',1590,null,true,0),
 ('now-collagen-peptides','NOW-COL-227','{"sq":"227 g","en":"227 g"}','{"size":"227g"}',1990,null,true,0),
 ('garden-of-life-collagen-beauty','GOL-CB-270','{"sq":"270 g berry","en":"270 g berry"}','{"size":"270g","flavor":"berry"}',3490,null,true,0),
 ('solgar-collagen-hyaluronic','SOL-CHA-30','{"sq":"30 tableta","en":"30 tablets"}','{"count":"30"}',2290,null,true,0),
 ('lamberts-ginkgo-biloba','LAM-GKO-60','{"sq":"60 tableta","en":"60 tablets"}','{"count":"60"}',1590,null,true,0),
 ('now-milk-thistle','NOW-MT-100','{"sq":"100 kapsula","en":"100 capsules"}','{"count":"100"}',1690,null,true,0),
 ('now-saw-palmetto','NOW-SP-90','{"sq":"90 softgel","en":"90 softgels"}','{"count":"90"}',1890,null,true,0),
 ('now-korean-ginseng','NOW-GIN-100','{"sq":"100 kapsula","en":"100 capsules"}','{"count":"100"}',1390,null,true,0),
 ('now-maca-500','NOW-MAC-100','{"sq":"100 kapsula","en":"100 capsules"}','{"count":"100"}',1290,null,true,0),
 ('now-cordyceps-750','NOW-CDY-90','{"sq":"90 kapsula","en":"90 capsules"}','{"count":"90"}',1990,null,true,0),
 ('garden-of-life-probiotics-50b','GOL-PRO-30','{"sq":"30 kapsula","en":"30 capsules"}','{"count":"30"}',3690,null,true,0),
 ('now-probiotic-10-25b','NOW-PRO-50','{"sq":"50 kapsula","en":"50 capsules"}','{"count":"50"}',2190,null,true,0),
 ('garden-of-life-womens-probiotic','GOL-WPR-30','{"sq":"30 kapsula","en":"30 capsules"}','{"count":"30"}',3490,null,true,0),
 ('myprotein-hydration-powder','MP-HYD-500','{"sq":"500 g portokall","en":"500 g orange"}','{"size":"500g","flavor":"orange"}',1590,null,true,0),
 ('biotechusa-mineral-complex','BTU-MIN-100','{"sq":"100 tableta","en":"100 tablets"}','{"count":"100"}',1290,null,true,0),
 ('garden-of-life-perfect-food-greens','GOL-PFG-240','{"sq":"240 g","en":"240 g"}','{"size":"240g"}',3190,null,true,0),
 ('now-mct-oil','NOW-MCT-473','{"sq":"473 ml","en":"473 ml"}','{"size":"473ml"}',1790,null,true,0),
 ('now-spirulina-500','NOW-SPI-200','{"sq":"200 tableta","en":"200 tablets"}','{"count":"200"}',1890,null,true,0),
 ('biocode-pill-organiser','BIO-ORG-7','{"sq":"7 ndarje","en":"7 compartments"}','{"color":"white"}',590,null,true,0),
 ('biocode-bottle-750','BIO-BTL-750','{"sq":"750 ml e zezë","en":"750 ml black"}','{"size":"750ml","color":"black"}',1090,null,true,0),
 -- Bundles: the compare-at is the sum of the parts at their own shelf prices.
 -- Sleep:    Solgar magnesium 18.50 + Jamieson melatonin  9.90 = 28.40 → 24.90
 -- Training: MP Impact whey 27.90 + Scitec creatine 14.90 + shaker 6.90 = 49.70 → 44.90
 ('pako-gjumi','BIO-PAKO-GJU','{"sq":"1 set","en":"1 set"}','{}',2490,2840,true,0),
 ('pako-stervitje','BIO-PAKO-STV','{"sq":"1 set","en":"1 set"}','{}',4490,4970,true,0)
) as v(product, sku, name, options, price, compare_at, is_default, position)
join products p on p.slug = v.product
on conflict (sku) do update set
  product_id = excluded.product_id, name = excluded.name, options = excluded.options,
  price_cents = excluded.price_cents, compare_at_price_cents = excluded.compare_at_price_cents,
  is_default = excluded.is_default, position = excluded.position;

-- -----------------------------------------------------------------------------
-- Opening stock.
--
-- Same shape as seed 02: `inventory_levels` and `stock_movements` written together so the invariant
-- in docs/07 §11 (on_hand == sum of movements) holds from the first row (docs/13 §A7). The
-- `apply_stock_movement` RPC is not usable here — it gates on `is_service_role()` or a staff role,
-- and a seed runs as the migration role, which is neither.
--
-- Its own note string, and scoped to these SKUs, so re-running neither doubles these movements nor
-- rewrites seed 02's.
-- -----------------------------------------------------------------------------
delete from stock_movements where note = 'seed 13 opening balance';

with levels(sku, on_hand) as (values
 ('VB-WM-30',46),('VB-WW-30',52),('NOW-K2-60',61),('NOW-MGC-100',88),('LAM-FE-60',37),
 ('SOL-CAMG-150',44),('SCI-WPP-920-CHOC',33),('SCI-WPP-920-VAN',28),('ON-CAS-908',19),
 ('BTU-IWZ-908-CHOC',26),('BTU-IWZ-908-VAN',22),('SCI-CRE-300',71),('ON-BCAA-200',24),
 ('SCI-EAA-300',31),('MP-GLU-500',43),('BTU-BA-300',35),('MP-PRE-420',29),('NN-UO-60',18),
 ('NN-AO-60',15),('NOW-CLO-180',54),('NOW-COL-227',48),('GOL-CB-270',17),('SOL-CHA-30',26),
 ('LAM-GKO-60',39),('NOW-MT-100',42),('NOW-SP-90',33),('NOW-GIN-100',57),('NOW-MAC-100',63),
 ('NOW-CDY-90',21),('GOL-PRO-30',23),('NOW-PRO-50',41),('GOL-WPR-30',19),('MP-HYD-500',36),
 ('BTU-MIN-100',58),('GOL-PFG-240',16),('NOW-MCT-473',34),('NOW-SPI-200',47),
 ('BIO-ORG-7',95),('BIO-BTL-750',72),('BIO-PAKO-GJU',14),('BIO-PAKO-STV',11)
)
insert into inventory_levels (variant_id, warehouse_id, on_hand, low_stock_threshold)
select pv.id, '11111111-0000-4000-8000-000000000001', l.on_hand, 5
  from levels l join product_variants pv on pv.sku = l.sku
on conflict (variant_id, warehouse_id) do update set on_hand = excluded.on_hand;

insert into stock_movements (variant_id, warehouse_id, type, quantity, note)
select il.variant_id, il.warehouse_id, 'received', il.on_hand, 'seed 13 opening balance'
  from inventory_levels il
  join product_variants pv on pv.id = il.variant_id
 where pv.sku in (
   'VB-WM-30','VB-WW-30','NOW-K2-60','NOW-MGC-100','LAM-FE-60','SOL-CAMG-150','SCI-WPP-920-CHOC',
   'SCI-WPP-920-VAN','ON-CAS-908','BTU-IWZ-908-CHOC','BTU-IWZ-908-VAN','SCI-CRE-300','ON-BCAA-200',
   'SCI-EAA-300','MP-GLU-500','BTU-BA-300','MP-PRE-420','NN-UO-60','NN-AO-60','NOW-CLO-180',
   'NOW-COL-227','GOL-CB-270','SOL-CHA-30','LAM-GKO-60','NOW-MT-100','NOW-SP-90','NOW-GIN-100',
   'NOW-MAC-100','NOW-CDY-90','GOL-PRO-30','NOW-PRO-50','GOL-WPR-30','MP-HYD-500','BTU-MIN-100',
   'GOL-PFG-240','NOW-MCT-473','NOW-SPI-200','BIO-ORG-7','BIO-BTL-750','BIO-PAKO-GJU','BIO-PAKO-STV'
 )
   and il.on_hand > 0;

-- -----------------------------------------------------------------------------
-- Categories. One primary each — `one_primary_category` is a unique index, not a convention.
--
-- Products in a child category are linked to the child only, not to the parent as well: the PLP for
-- a parent already includes its children's products, so a second link would double-count.
-- -----------------------------------------------------------------------------
insert into product_categories (product_id, category_id, is_primary)
select p.id, c.id, true
from (values
 ('vitabiotics-wellman','vitaminat'),('vitabiotics-wellwoman','vitaminat'),('now-vitamin-k2-mk7','vitaminat'),
 ('now-magnesium-citrate','mineralet'),('lamberts-iron-bisglycinate','mineralet'),('solgar-calcium-magnesium-d3','mineralet'),
 ('scitec-whey-professional','proteina'),('on-gold-standard-casein','proteina'),('biotechusa-iso-whey-zero','proteina'),
 ('scitec-creatine-monohydrate','kreatina'),
 ('on-bcaa-1000','aminoacidet'),('scitec-eaa-plus-glutamine','aminoacidet'),
 ('myprotein-l-glutamine','aminoacidet'),('biotechusa-beta-alanine','aminoacidet'),
 ('myprotein-the-pre-workout','nutricion-sportiv'),
 ('nordic-naturals-ultimate-omega','omega'),('nordic-naturals-algae-omega','omega'),('now-cod-liver-oil','omega'),
 ('now-collagen-peptides','kolagjeni'),('garden-of-life-collagen-beauty','kolagjeni'),('solgar-collagen-hyaluronic','kolagjeni'),
 ('lamberts-ginkgo-biloba','bimore'),('now-milk-thistle','bimore'),('now-saw-palmetto','bimore'),
 ('now-korean-ginseng','adaptogjenet'),('now-maca-500','adaptogjenet'),('now-cordyceps-750','adaptogjenet'),
 ('garden-of-life-probiotics-50b','probiotiket'),('now-probiotic-10-25b','probiotiket'),('garden-of-life-womens-probiotic','probiotiket'),
 ('myprotein-hydration-powder','elektrolitet'),('biotechusa-mineral-complex','elektrolitet'),
 ('garden-of-life-perfect-food-greens','ushqime-funksionale'),('now-mct-oil','ushqime-funksionale'),('now-spirulina-500','ushqime-funksionale'),
 ('biocode-pill-organiser','aksesore'),('biocode-bottle-750','aksesore'),
 ('pako-gjumi','pako'),('pako-stervitje','pako')
) as v(product, category)
join products p on p.slug = v.product
join categories c on c.slug = v.category
on conflict (product_id, category_id) do update set is_primary = excluded.is_primary;

-- -----------------------------------------------------------------------------
-- Health goals. One or two each — a product tagged with six goals is tagged with none.
-- -----------------------------------------------------------------------------
insert into product_health_goals (product_id, goal_id)
select p.id, g.id
from (values
 ('vitabiotics-wellman','energji'),('vitabiotics-wellman','shendeti-i-burrit'),
 ('vitabiotics-wellwoman','energji'),('vitabiotics-wellwoman','shendeti-i-gruas'),
 ('now-vitamin-k2-mk7','kockat'),
 ('now-magnesium-citrate','energji'),('now-magnesium-citrate','gjumi'),
 ('lamberts-iron-bisglycinate','energji'),('lamberts-iron-bisglycinate','shendeti-i-gruas'),
 ('solgar-calcium-magnesium-d3','kockat'),
 ('scitec-whey-professional','pesha'),('on-gold-standard-casein','pesha'),('biotechusa-iso-whey-zero','pesha'),
 ('scitec-creatine-monohydrate','energji'),
 ('on-bcaa-1000','energji'),('scitec-eaa-plus-glutamine','energji'),
 ('myprotein-l-glutamine','tretja'),('biotechusa-beta-alanine','energji'),
 ('myprotein-the-pre-workout','energji'),('myprotein-the-pre-workout','truri'),
 ('nordic-naturals-ultimate-omega','zemra'),('nordic-naturals-ultimate-omega','truri'),
 ('nordic-naturals-algae-omega','zemra'),('now-cod-liver-oil','zemra'),
 ('now-collagen-peptides','lekura'),('now-collagen-peptides','nyjet'),
 ('garden-of-life-collagen-beauty','lekura'),('garden-of-life-collagen-beauty','floket'),
 ('solgar-collagen-hyaluronic','lekura'),('solgar-collagen-hyaluronic','nyjet'),
 ('lamberts-ginkgo-biloba','truri'),('now-milk-thistle','tretja'),('now-saw-palmetto','shendeti-i-burrit'),
 ('now-korean-ginseng','energji'),('now-maca-500','energji'),('now-cordyceps-750','energji'),
 ('garden-of-life-probiotics-50b','tretja'),('garden-of-life-probiotics-50b','imuniteti'),
 ('now-probiotic-10-25b','tretja'),('garden-of-life-womens-probiotic','shendeti-i-gruas'),
 ('myprotein-hydration-powder','energji'),('biotechusa-mineral-complex','energji'),
 ('garden-of-life-perfect-food-greens','tretja'),('now-mct-oil','pesha'),('now-spirulina-500','energji'),
 ('pako-gjumi','gjumi'),('pako-stervitje','pesha')
) as v(product, goal)
join products p on p.slug = v.product
join health_goals g on g.slug = v.goal
on conflict (product_id, goal_id) do nothing;

-- -----------------------------------------------------------------------------
-- Ingredients, with the amount per serving where the label states one.
--
-- `nrv_pct` is left null throughout: the reference intake percentage depends on the exact label and
-- getting it wrong is worse than omitting it — the PDP renders the column only when it is present.
-- -----------------------------------------------------------------------------
insert into product_ingredients (product_id, ingredient_id, amount, unit, per_serving, position)
select p.id, i.id, v.amount, v.unit, true, v.position
from (values
 ('vitabiotics-wellman','zinc',15,'mg',0),('vitabiotics-wellman','selenium',150,'µg',1),
 ('vitabiotics-wellwoman','iron',12,'mg',0),('vitabiotics-wellwoman','vitamin-b12',9,'µg',1),
 ('now-vitamin-k2-mk7','vitamin-k2',100,'µg',0),
 ('now-magnesium-citrate','magnesium',400,'mg',0),
 ('lamberts-iron-bisglycinate','iron',20,'mg',0),('lamberts-iron-bisglycinate','vitamin-c',100,'mg',1),
 ('solgar-calcium-magnesium-d3','calcium',1000,'mg',0),('solgar-calcium-magnesium-d3','magnesium',500,'mg',1),
 ('solgar-calcium-magnesium-d3','vitamin-d3',600,'IU',2),
 ('scitec-whey-professional','whey-protein',22,'g',0),
 ('on-gold-standard-casein','casein',24,'g',0),
 ('biotechusa-iso-whey-zero','whey-protein',22,'g',0),
 ('scitec-creatine-monohydrate','creatine',3,'g',0),
 ('on-bcaa-1000','bcaa',2,'g',0),
 ('scitec-eaa-plus-glutamine','eaa',8,'g',0),('scitec-eaa-plus-glutamine','l-glutamine',2,'g',1),
 ('myprotein-l-glutamine','l-glutamine',5,'g',0),
 ('biotechusa-beta-alanine','beta-alanine',3,'g',0),
 ('myprotein-the-pre-workout','caffeine',150,'mg',0),('myprotein-the-pre-workout','beta-alanine',1600,'mg',1),
 ('nordic-naturals-ultimate-omega','omega-3',1280,'mg',0),
 ('nordic-naturals-algae-omega','omega-3',715,'mg',0),
 ('now-cod-liver-oil','omega-3',300,'mg',0),
 ('now-collagen-peptides','collagen',10,'g',0),
 ('garden-of-life-collagen-beauty','collagen',10,'g',0),('garden-of-life-collagen-beauty','vitamin-c',30,'mg',1),
 ('solgar-collagen-hyaluronic','hyaluronic-acid',120,'mg',0),('solgar-collagen-hyaluronic','collagen',30,'mg',1),
 ('lamberts-ginkgo-biloba','ginkgo-biloba',120,'mg',0),
 ('now-milk-thistle','milk-thistle',300,'mg',0),('now-milk-thistle','curcumin',50,'mg',1),
 ('now-saw-palmetto','saw-palmetto',320,'mg',0),
 ('now-korean-ginseng','ginseng',500,'mg',0),
 ('now-maca-500','maca',500,'mg',0),
 ('now-cordyceps-750','cordyceps',750,'mg',0),
 ('garden-of-life-probiotics-50b','probiotic',50,'miliardë CFU',0),
 ('now-probiotic-10-25b','probiotic',25,'miliardë CFU',0),
 ('garden-of-life-womens-probiotic','probiotic',50,'miliardë CFU',0),
 ('myprotein-hydration-powder','electrolytes',1,'g',0),
 ('biotechusa-mineral-complex','magnesium',150,'mg',0),('biotechusa-mineral-complex','calcium',300,'mg',1),
 ('garden-of-life-perfect-food-greens','spirulina',1,'g',0),
 ('now-mct-oil','mct-oil',14,'g',0),
 ('now-spirulina-500','spirulina',1500,'mg',0),
 ('pako-gjumi','magnesium',400,'mg',0),('pako-gjumi','melatonin',3,'mg',1),
 ('pako-stervitje','whey-protein',25,'g',0),('pako-stervitje','creatine',3,'g',1)
) as v(product, ingredient, amount, unit, position)
join products p on p.slug = v.product
join ingredients i on i.slug = v.ingredient
on conflict (product_id, ingredient_id) do update set
  amount = excluded.amount, unit = excluded.unit, position = excluded.position;

-- -----------------------------------------------------------------------------
-- Certifications, by rule rather than by row.
--
-- These are facts derivable from what is already recorded, so deriving them keeps the two from
-- drifting: a product tagged `vegan` in `dietary_tags` carries the vegan certification, and one that
-- does not, does not. Written as three set-based statements over the **whole** catalogue, which also
-- backfills the 18 of 24 existing products that had none.
--
-- GMP goes on everything except BIOCODE's own accessories and bundles: a shaker is not manufactured
-- under a supplement GMP regime, and claiming it is would be a false certification on a product page.
-- -----------------------------------------------------------------------------
insert into product_certifications (product_id, certification_id)
select p.id, c.id
  from products p
  join brands b on b.id = p.brand_id
  join certifications c on c.slug = 'gmp'
 where p.deleted_at is null
   and b.slug <> 'biocode'
on conflict do nothing;

insert into product_certifications (product_id, certification_id)
select p.id, c.id
  from products p
  join certifications c on c.slug = 'vegan'
 where p.deleted_at is null
   and 'vegan' = any (p.dietary_tags)
on conflict do nothing;

insert into product_certifications (product_id, certification_id)
select p.id, c.id
  from products p
  join certifications c on c.slug = 'non-gmo'
 where p.deleted_at is null
   and 'non_gmo' = any (p.dietary_tags)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Backfilling the 24 products from seed 01.
--
-- `seo` was empty on every one of them, so each product page inherited the site-wide title and had
-- no meta description at all — the single largest SEO gap in the shop, because a product page is what
-- a brand-plus-dose search lands on.
--
-- **Derived, not written.** The title is the product name plus the site name; the description is the
-- subtitle followed by the first sentence of the body copy, trimmed. That is a floor rather than a
-- finish: hand-written meta descriptions convert better, and the product editor is where the
-- catalogue team should improve them. A derived description that reads correctly beats an empty tag,
-- and beats a hand-written one that nobody has time to write for 24 products.
--
-- Scoped to `seo = '{}'` so the 39 hand-written ones above are never overwritten.
-- -----------------------------------------------------------------------------
update products p set seo = jsonb_build_object(
  'title', jsonb_build_object(
    'sq', (p.name->>'sq') || ' | BIOCODE',
    'en', (p.name->>'en') || ' | BIOCODE'
  ),
  'description', jsonb_build_object(
    'sq', left(
      trim(coalesce(p.subtitle->>'sq', '') || '. ' || split_part(coalesce(p.description->>'sq', ''), '.', 1)),
      155
    ),
    'en', left(
      trim(coalesce(p.subtitle->>'en', '') || '. ' || split_part(coalesce(p.description->>'en', ''), '.', 1)),
      155
    )
  )
)
where p.seo = '{}'::jsonb
  and p.deleted_at is null
  and p.name->>'en' is not null;

/*
 * The three fields the audit found thin on the seed-01 products.
 *
 * `serving_size` on the shaker is genuinely not applicable — an accessory has no serving — so it stays
 * null and the PDP omits the row. The two dietary-tag gaps are the bundle and the shaker, where the
 * tags belong to the products inside rather than to the pack.
 *
 * Warnings were missing on nine. Each of these is a fact about the product, not a legal disclaimer:
 * the site-wide supplement disclaimer already appears on every page (docs/08 §7.3), and this column is
 * for what is specific to the item in the customer's hand.
 */
update products set warnings = '{"sq":"Përmban qumësht dhe soje. Nuk zëvendëson një vakt të ekuilibruar.","en":"Contains milk and soy. Not a substitute for a balanced meal."}'::jsonb
 where slug in ('on-gold-standard-whey','myprotein-impact-whey') and warnings = '{}'::jsonb;

update products set warnings = '{"sq":"Përmban soje. Nuk zëvendëson një vakt të ekuilibruar.","en":"Contains soy. Not a substitute for a balanced meal."}'::jsonb
 where slug = 'myprotein-vegan-blend' and warnings = '{}'::jsonb;

update products set warnings = '{"sq":"Pi ujë të mjaftueshëm gjatë ditës.","en":"Drink enough water through the day."}'::jsonb
 where slug in ('on-micronised-creatine','biotechusa-100-creatine') and warnings = '{}'::jsonb;

update products set warnings = '{"sq":"Përmban peshk. Nëse merr antikoagulantë, konsulto mjekun.","en":"Contains fish. If you take anticoagulants, consult a doctor."}'::jsonb
 where slug in ('now-omega-3-1000','solgar-omega-3-6-9') and warnings = '{}'::jsonb;

update products set warnings = '{"sq":"Burim bovin. Jo i përshtatshëm për vegjetarianë.","en":"Bovine source. Not suitable for vegetarians."}'::jsonb
 where slug = 'swisse-collagen-peptides' and warnings = '{}'::jsonb;

update products set warnings = '{"sq":"Merre me ushqim. Doza të larta mund të shkaktojnë çrregullime të lehta të tretjes.","en":"Take with food. High doses may cause mild digestive upset."}'::jsonb
 where slug in ('solgar-vitamin-c-1000','now-zinc-picolinate-50','terranova-b-complex','jamieson-b12-1000','now-curcumin','biotechusa-probiotic','now-psyllium-husk','swisse-hair-skin-nails') and warnings = '{}'::jsonb;

update products set serving_size = '1 dozë (30 g)' where slug = 'myprotein-vegan-blend' and serving_size is null;
update products set dietary_tags = '{gluten_free}' where slug in ('biocode-shaker-600') and cardinality(dietary_tags) = 0;
update products set dietary_tags = '{vegan,gluten_free,sugar_free}' where slug in ('on-micronised-creatine','biotechusa-100-creatine') and cardinality(dietary_tags) = 0;
