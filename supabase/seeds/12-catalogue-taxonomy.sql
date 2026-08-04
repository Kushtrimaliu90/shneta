-- =============================================================================
-- Seed 12 — the catalogue taxonomy, finished: category copy, brand copy, SEO
--
-- ── What this fixes ──
--
-- The taxonomy shipped in seed 01 with names and nothing else. Measured against the columns the
-- storefront actually reads:
--
--     categories: description missing on 16/16, seo missing on 16/16
--     brands:     description missing on 7/9,   seo missing on 9/9
--
-- `getCategoryTree` selects `description`, so every category page had a heading and no words under
-- it — and no `<title>` or meta description of its own, which for a supplement shop is the largest
-- organic surface there is. Category and brand pages are what people land on from a search for
-- "magnesium bisglycinate Kosovo"; a page with no copy ranks for nothing and converts worse.
--
-- ── What it deliberately does not do ──
--
--   · **No `image_path` or `logo_path`.** Those are files, not text, and the files have to be
--     licensed — brand logos from the brand's own dealer assets, product photography either from
--     the manufacturer's media kit or shot in-house. Pointing these columns at a path that does not
--     exist would break `next/image` on every card; leaving them null renders the branded fallback
--     tile the UI already has (docs/04 §9). `pnpm seed:images` is the way in once assets exist.
--   · **No category `icon`.** The column exists but `getCategoryTree` does not select it, so filling
--     it would be data nothing reads. Health goals *do* render an icon and already have one.
--
-- ── Copy rules ──
--
-- Every description is claim-safe (docs/08 §7): what a category *contains* and who buys from it,
-- never what it does to a body. "Magnesium, zinc and iron in forms chosen for absorption" is a fact
-- about a shelf. "Magnesium for better sleep" is a health claim, and it is the sort that arrives in
-- category copy because nobody thinks of category copy as claims.
--
-- SEO titles are written for the query, not for us: `Magnesium & Minerals | BIOCODE` beats
-- `Mineralet — kategoria` because the first is what somebody typed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- One stray brand from an early session, invisible to every purge pattern.
--
-- `The Governor` / `governor` came from a manual admin test on 2026-08-02 and has no products. It
-- is not matched by `slug LIKE 'brand-%'`, which is what the fixture sweep looks for, so it sat in
-- the brand list on the storefront (docs/13 §X16 — the same shape of leak, found the same way).
-- -----------------------------------------------------------------------------
delete from brands
 where slug = 'governor'
   and not exists (select 1 from products where products.brand_id = brands.id);

-- -----------------------------------------------------------------------------
-- Categories: description + SEO.
--
-- Matched on slug rather than id so this file is readable on its own and survives a re-seed.
-- -----------------------------------------------------------------------------
update categories set
  description = '{"sq":"Vitamina të veçanta dhe multivitamina nga prodhues me standarde GMP. Doza të shënuara qartë, forma që trupi i thith mirë, dhe përmbajtje e verifikueshme në etiketë.","en":"Single vitamins and multivitamins from GMP-standard manufacturers. Clearly stated doses, well-absorbed forms, and label content you can check."}'::jsonb,
  seo = '{"title":{"sq":"Vitamina — D3, C, B12 dhe multivitamina | BIOCODE","en":"Vitamins — D3, C, B12 and multivitamins | BIOCODE"},"description":{"sq":"Vitamina origjinale me dozë të shënuar dhe formë të thithshme. Dërgesa në të gjithë Kosovën, pagesa në dorëzim.","en":"Genuine vitamins with stated doses and absorbable forms. Delivery across Kosovo, cash on delivery."}}'::jsonb
where slug = 'vitaminat';

update categories set
  description = '{"sq":"Magnez, zink, hekur dhe kalcium në forma të zgjedhura për thithje — bisglicinat, pikolinat, citrat. Shumica e mineralëve ndryshojnë më shumë nga forma sesa nga doza.","en":"Magnesium, zinc, iron and calcium in forms chosen for absorption — bisglycinate, picolinate, citrate. With minerals the form usually matters more than the dose."}'::jsonb,
  seo = '{"title":{"sq":"Mineralet — magnez, zink, hekur | BIOCODE","en":"Minerals — magnesium, zinc, iron | BIOCODE"},"description":{"sq":"Minerale në forma të thithshme: magnez bisglicinat, zink pikolinat, hekur i butë për stomakun.","en":"Minerals in absorbable forms: magnesium bisglycinate, zinc picolinate, gentle iron."}}'::jsonb
where slug = 'mineralet';

update categories set
  description = '{"sq":"Proteina, kreatinë, aminoacide dhe para-stërvitje për ata që stërvitin rregullisht. Çmimi për porcion është shënuar në secilin produkt, sepse ai është numri që ka kuptim.","en":"Protein, creatine, amino acids and pre-workout for people who train regularly. Cost per serving is shown on every product, because that is the number that matters."}'::jsonb,
  seo = '{"title":{"sq":"Nutricion sportiv — proteina, kreatinë, aminoacide | BIOCODE","en":"Sports nutrition — protein, creatine, amino acids | BIOCODE"},"description":{"sq":"Proteina whey dhe vegane, kreatinë monohidrat, BCAA dhe EAA. Marka origjinale, çmim për porcion i shënuar.","en":"Whey and vegan protein, creatine monohydrate, BCAA and EAA. Genuine brands, cost per serving shown."}}'::jsonb
where slug = 'nutricion-sportiv';

update categories set
  description = '{"sq":"Whey konsentrat dhe izolat, kazeinë dhe proteina bimore. Gramët e proteinës për porcion dhe profili i aminoacideve janë në tabelën e secilit produkt.","en":"Whey concentrate and isolate, casein, and plant protein. Grams of protein per serving and the amino profile are on each product page."}'::jsonb,
  seo = '{"title":{"sq":"Proteina — whey, izolat, vegane | BIOCODE","en":"Protein — whey, isolate, vegan | BIOCODE"},"description":{"sq":"Proteina whey, izolat dhe vegane nga marka të njohura. Shije të provuara, çmim për porcion.","en":"Whey, isolate and vegan protein from established brands. Tested flavours, cost per serving."}}'::jsonb
where slug = 'proteina';

update categories set
  description = '{"sq":"Kreatinë monohidrat, mikronizuar për t''u shpërndarë më lehtë. Suplementi më i studiuar në nutricionin sportiv, dhe një nga më të lirët për porcion.","en":"Creatine monohydrate, micronised so it disperses more easily. The most studied supplement in sports nutrition, and one of the cheapest per serving."}'::jsonb,
  seo = '{"title":{"sq":"Kreatinë monohidrat | BIOCODE","en":"Creatine monohydrate | BIOCODE"},"description":{"sq":"Kreatinë monohidrat mikronizuar, pa mbushës. 300 g deri 634 g, çmim për porcion i shënuar.","en":"Micronised creatine monohydrate, no fillers. 300 g to 634 g, cost per serving shown."}}'::jsonb
where slug = 'kreatina';

update categories set
  description = '{"sq":"BCAA, EAA, glutaminë dhe beta-alaninë në pluhur dhe kapsula. Përmbajtja e secilit aminoacid për porcion është e shënuar, jo vetëm totali.","en":"BCAA, EAA, glutamine and beta-alanine in powder and capsules. The amount of each amino acid per serving is stated, not just the total."}'::jsonb,
  seo = '{"title":{"sq":"Aminoacide — BCAA, EAA, glutaminë | BIOCODE","en":"Amino acids — BCAA, EAA, glutamine | BIOCODE"},"description":{"sq":"BCAA 2:1:1, EAA me spektër të plotë, L-glutaminë dhe beta-alaninë. Dozë e shënuar për aminoacid.","en":"BCAA 2:1:1, full-spectrum EAA, L-glutamine and beta-alanine. Per-amino dosing stated."}}'::jsonb
where slug = 'aminoacidet';

update categories set
  description = '{"sq":"Vaj peshku, vaj algash dhe përzierje omega 3-6-9. EPA dhe DHA për porcion janë të shënuara — ato janë përbërësit që numërohen, jo gramët e vajit.","en":"Fish oil, algal oil and omega 3-6-9 blends. EPA and DHA per serving are stated — those are what count, not the grams of oil."}'::jsonb,
  seo = '{"title":{"sq":"Omega-3 — vaj peshku dhe vaj algash | BIOCODE","en":"Omega-3 — fish oil and algal oil | BIOCODE"},"description":{"sq":"Omega-3 me EPA dhe DHA të shënuara për porcion, përfshirë opsion vegan nga algat.","en":"Omega-3 with EPA and DHA stated per serving, including a vegan algal option."}}'::jsonb
where slug = 'omega';

update categories set
  description = '{"sq":"Peptide kolagjeni tip I dhe III në pluhur dhe kapsula, disa me vitaminë C. Pluhurat treten në pije të ftohta ose të ngrohta.","en":"Type I and III collagen peptides in powder and capsules, some with vitamin C. The powders dissolve in cold or warm drinks."}'::jsonb,
  seo = '{"title":{"sq":"Kolagjen — peptide tip I dhe III | BIOCODE","en":"Collagen — type I and III peptides | BIOCODE"},"description":{"sq":"Peptide kolagjeni të hidrolizuara, deti dhe bovine, me ose pa vitaminë C.","en":"Hydrolysed collagen peptides, marine and bovine, with or without vitamin C."}}'::jsonb
where slug = 'kolagjeni';

update categories set
  description = '{"sq":"Ekstrakte bimore me raport standardizuar — kurkuma, gjinko, hithra, sharra e palmës. Raporti i ekstraktit është shënuar, sepse pa të një gram nuk thotë asgjë.","en":"Herbal extracts with a standardised ratio — turmeric, ginkgo, nettle, saw palmetto. The extract ratio is stated, because without it a gram means nothing."}'::jsonb,
  seo = '{"title":{"sq":"Suplemente bimore — kurkuma, gjinko, hithra | BIOCODE","en":"Herbal supplements — turmeric, ginkgo, nettle | BIOCODE"},"description":{"sq":"Ekstrakte bimore standardizuara nga prodhues me GMP, me raport ekstrakti të shënuar.","en":"Standardised herbal extracts from GMP manufacturers, with the extract ratio stated."}}'::jsonb
where slug = 'bimore';

update categories set
  description = '{"sq":"Ashwagandha, rodiola, ginseng dhe maca — bimë të përdorura tradicionalisht, në ekstrakte të standardizuara. Përmbajtja aktive është shënuar për kapsulë.","en":"Ashwagandha, rhodiola, ginseng and maca — traditionally used plants, as standardised extracts. Active content is stated per capsule."}'::jsonb,
  seo = '{"title":{"sq":"Adaptogjenë — ashwagandha, rodiola, ginseng | BIOCODE","en":"Adaptogens — ashwagandha, rhodiola, ginseng | BIOCODE"},"description":{"sq":"Ekstrakte adaptogjene të standardizuara: KSM-66, rodiola 3% rozavina, ginseng koreano.","en":"Standardised adaptogen extracts: KSM-66, rhodiola 3% rosavins, Korean ginseng."}}'::jsonb
where slug = 'adaptogjenet';

update categories set
  description = '{"sq":"Probiotikë me numër CFU dhe shtame të shënuara, disa të qëndrueshëm në raft dhe disa që duhen mbajtur në frigorifer. Shtami ka më shumë peshë se numri.","en":"Probiotics with CFU counts and named strains, some shelf-stable and some refrigerated. The strain matters more than the number."}'::jsonb,
  seo = '{"title":{"sq":"Probiotikë — shtame të shënuara, CFU e verifikueshme | BIOCODE","en":"Probiotics — named strains, verifiable CFU | BIOCODE"},"description":{"sq":"Probiotikë shumë-shtamësh me CFU në datën e skadencës, jo në datën e prodhimit.","en":"Multi-strain probiotics with CFU at expiry, not at manufacture."}}'::jsonb
where slug = 'probiotiket';

update categories set
  description = '{"sq":"Tableta, pluhur dhe qeska me natrium, kalium dhe magnez për stërvitje të gjata ose ditë të nxehta. Pa sheqer ose me sheqer minimal, sipas produktit.","en":"Tablets, powders and sachets with sodium, potassium and magnesium for long sessions or hot days. Sugar-free or low-sugar, depending on the product."}'::jsonb,
  seo = '{"title":{"sq":"Elektrolitë — tableta dhe pluhur hidratimi | BIOCODE","en":"Electrolytes — hydration tablets and powders | BIOCODE"},"description":{"sq":"Elektrolitë me natrium, kalium dhe magnez të shënuar për porcion. Pa sheqer.","en":"Electrolytes with sodium, potassium and magnesium stated per serving. Sugar-free options."}}'::jsonb
where slug = 'elektrolitet';

update categories set
  description = '{"sq":"Fibra, spirulinë, MCT dhe pluhura të gjelbër — ushqim i koncentruar më shumë se suplement. Përbërja e plotë është në etiketë, pa përzierje të fshehura.","en":"Fibre, spirulina, MCT and greens powders — concentrated food more than supplement. Full composition on the label, no hidden blends."}'::jsonb,
  seo = '{"title":{"sq":"Ushqime funksionale — fibra, spirulinë, MCT | BIOCODE","en":"Functional foods — fibre, spirulina, MCT | BIOCODE"},"description":{"sq":"Fibra psyllium, spirulinë, vaj MCT dhe pluhura të gjelbër me përbërje të plotë në etiketë.","en":"Psyllium fibre, spirulina, MCT oil and greens powders with full label composition."}}'::jsonb
where slug = 'ushqime-funksionale';

update categories set
  description = '{"sq":"Shaker, kuti dozimi dhe shishe BIOCODE — gjëra që i duhen njërit që merr suplemente rregullisht, të bëra për t''u lëshuar dhe për t''u lënë në makinë.","en":"BIOCODE shakers, pill organisers and bottles — the things somebody taking supplements daily actually needs, built to be dropped and left in a car."}'::jsonb,
  seo = '{"title":{"sq":"Aksesorë — shaker, kuti dozimi, shishe | BIOCODE","en":"Accessories — shakers, organisers, bottles | BIOCODE"},"description":{"sq":"Shaker 600 ml pa BPA, kuti dozimi shtatë-ditore dhe shishe BIOCODE.","en":"BPA-free 600 ml shakers, seven-day pill organisers and BIOCODE bottles."}}'::jsonb
where slug = 'aksesore';

update categories set
  description = '{"sq":"Kombinime të zgjedhura që zakonisht merren bashkë, me çmim më të lirë sesa të blera veç. Përbërja e secilës pako është e shënuar produkt për produkt.","en":"Chosen combinations that are usually taken together, priced below buying them separately. Each bundle lists exactly what is in it."}'::jsonb,
  seo = '{"title":{"sq":"Pako — kombinime me çmim më të mirë | BIOCODE","en":"Bundles — better value combinations | BIOCODE"},"description":{"sq":"Pako imuniteti, gjumi dhe stërvitjeje. Çmimi i pakos kundrejt çmimit veç është i shënuar.","en":"Immunity, sleep and training bundles. Bundle price against separate price is shown."}}'::jsonb
where slug = 'pako';

/*
 * Gift cards go **inactive**, not populated.
 *
 * A gift card is a promise to deliver a code, and v1 fulfils codes by hand (docs/12 post-v1
 * backlog) with an email system that has never successfully sent a message (docs/14 §20). Listing
 * one would take money for something with no delivery path — worse than an empty category, which is
 * all it is today.
 *
 * The read policy is `is_active and deleted_at is null`, so this removes it from the storefront and
 * from the nav while leaving the row for the day the balance system exists.
 */
update categories set
  is_active = false,
  description = '{"sq":"Kartat dhuratë kthehen kur sistemi i bilancit të tyre është gati.","en":"Gift cards return once their balance system is built."}'::jsonb
where slug = 'karta-dhurate';

-- -----------------------------------------------------------------------------
-- Brands.
--
-- ── On listing real brands ──
--
-- Naming a manufacturer is what every retailer does and is lawful nominative use. **Selling its
-- products is a different question**, and it needs a supply agreement — so this list is the shape
-- of a launch catalogue, and the owner should keep the brands it actually has distribution for and
-- deactivate the rest rather than delete them (docs/14 §20).
--
-- `country_code` and `website_url` are facts about the manufacturer, not claims by us. No logo
-- paths: a logo is a trademark-protected file that comes from the brand's dealer assets.
-- -----------------------------------------------------------------------------
update brands set
  description = '{"sq":"Prodhues amerikan familjar që nga 1968, me laboratorë të vetë dhe testim për identitet e pastërti. Katalog i gjerë me çmim të arsyeshëm për porcion.","en":"Family-owned US manufacturer since 1968, with in-house labs and testing for identity and purity. A broad catalogue at a sensible cost per serving."}'::jsonb,
  country_code = 'US', website_url = 'https://www.nowfoods.com', sort_order = 0,
  seo = '{"title":{"sq":"NOW Foods në Kosovë | BIOCODE","en":"NOW Foods in Kosovo | BIOCODE"},"description":{"sq":"Vitamina, minerale dhe vajra NOW Foods, origjinale, me dërgesë në Kosovë.","en":"Genuine NOW Foods vitamins, minerals and oils, delivered in Kosovo."}}'::jsonb
where slug = 'now-foods';

update brands set
  description = '{"sq":"Marka e proteinës më e shitur në botë, e njohur për Gold Standard Whey. Shije të stabilizuara dhe përbërje që nuk ndryshon nga një seri në tjetrën.","en":"The world''s best-selling protein brand, known for Gold Standard Whey. Consistent flavours and a formula that does not shift between batches."}'::jsonb,
  country_code = 'US', website_url = 'https://www.optimumnutrition.com', sort_order = 1,
  seo = '{"title":{"sq":"Optimum Nutrition në Kosovë | BIOCODE","en":"Optimum Nutrition in Kosovo | BIOCODE"},"description":{"sq":"Gold Standard Whey dhe kreatinë ON, origjinale, me dërgesë në Kosovë.","en":"Genuine ON Gold Standard Whey and creatine, delivered in Kosovo."}}'::jsonb
where slug = 'optimum-nutrition';

update brands set
  description = '{"sq":"Prodhues britanik me çmim të drejtpërdrejtë dhe zgjedhje shijesh më e gjerë sesa kushdo. Vlerë e mirë për porcion në whey dhe në proteina vegane.","en":"UK manufacturer with direct pricing and a wider flavour range than anyone. Good value per serving in both whey and vegan protein."}'::jsonb,
  country_code = 'GB', website_url = 'https://www.myprotein.com', sort_order = 2,
  seo = '{"title":{"sq":"MyProtein në Kosovë | BIOCODE","en":"MyProtein in Kosovo | BIOCODE"},"description":{"sq":"Impact Whey, proteina vegane dhe elektrolitë MyProtein me dërgesë në Kosovë.","en":"MyProtein Impact Whey, vegan protein and electrolytes delivered in Kosovo."}}'::jsonb
where slug = 'myprotein';

update brands set
  description = '{"sq":"Prodhues hungarez, i shpërndarë gjerësisht në Ballkan, me fabrikë dhe kontroll cilësie brenda BE-së. Çmim i mirë për porcion në kreatinë dhe probiotikë.","en":"Hungarian manufacturer, widely distributed across the Balkans, producing and quality-testing inside the EU. Good value per serving in creatine and probiotics."}'::jsonb,
  country_code = 'HU', website_url = 'https://www.biotechusa.com', sort_order = 3,
  seo = '{"title":{"sq":"BioTechUSA në Kosovë | BIOCODE","en":"BioTechUSA in Kosovo | BIOCODE"},"description":{"sq":"Kreatinë, probiotikë dhe proteina BioTechUSA, prodhim në BE, dërgesë në Kosovë.","en":"BioTechUSA creatine, probiotics and protein, EU-made, delivered in Kosovo."}}'::jsonb
where slug = 'biotechusa';

update brands set
  description = '{"sq":"Markë britanike me formula pa mbushës, pa lidhës dhe pa lyerje — vetëm përbërësi dhe kapsula. Doza më modeste, përbërje më e shkurtër.","en":"UK brand whose formulas carry no fillers, binders or coatings — the ingredient and the capsule, nothing else. Modest doses, short ingredient lists."}'::jsonb,
  country_code = 'GB', website_url = 'https://www.terranovahealth.com', sort_order = 4,
  seo = '{"title":{"sq":"Terranova në Kosovë | BIOCODE","en":"Terranova in Kosovo | BIOCODE"},"description":{"sq":"Formula Terranova pa mbushës: B-complex, ashwagandha, magnez.","en":"Filler-free Terranova formulas: B-complex, ashwagandha, magnesium."}}'::jsonb
where slug = 'terranova';

update brands set
  description = '{"sq":"Prodhues kanadez nën rregullat e Health Canada, ku numri i licencës është në secilën kuti. Doza konservative dhe etiketë e lexueshme.","en":"Canadian manufacturer under Health Canada rules, with the licence number on every box. Conservative doses and a label you can read."}'::jsonb,
  country_code = 'CA', website_url = 'https://www.jamiesonvitamins.com', sort_order = 5,
  seo = '{"title":{"sq":"Jamieson në Kosovë | BIOCODE","en":"Jamieson in Kosovo | BIOCODE"},"description":{"sq":"Vitamina Jamieson nga Kanadaja: B12, melatoninë, multivitamina.","en":"Jamieson vitamins from Canada: B12, melatonin, multivitamins."}}'::jsonb
where slug = 'jamieson';

update brands set
  description = '{"sq":"Markë australiane me fokus në formula të përditshme dhe në lëkurë, flokë e thonj. Paketim i thjeshtë, doza të matura për përdorim të gjatë.","en":"Australian brand focused on daily formulas and on skin, hair and nails. Plain packaging, doses measured for long-term use."}'::jsonb,
  country_code = 'AU', website_url = 'https://www.swisse.com', sort_order = 6,
  seo = '{"title":{"sq":"Swisse në Kosovë | BIOCODE","en":"Swisse in Kosovo | BIOCODE"},"description":{"sq":"Kolagjen, flokë-lëkurë-thonj dhe formula të përditshme Swisse.","en":"Swisse collagen, hair-skin-nails and daily formulas."}}'::jsonb
where slug = 'swisse';

update brands set
  description = '{"sq":"Markë amerikane premium që nga 1947, me forma të thithshme si bisglicinat dhe metilkobalaminë. Më e shtrenjtë për porcion, dhe e zgjedhur për formën.","en":"US premium brand since 1947, using absorbable forms like bisglycinate and methylcobalamin. More expensive per serving, and chosen for the form."}'::jsonb,
  country_code = 'US', website_url = 'https://www.solgar.com', sort_order = 7,
  seo = '{"title":{"sq":"Solgar në Kosovë | BIOCODE","en":"Solgar in Kosovo | BIOCODE"},"description":{"sq":"Magnez bisglicinat, vitaminë C dhe omega Solgar, origjinale, në Kosovë.","en":"Genuine Solgar magnesium bisglycinate, vitamin C and omega in Kosovo."}}'::jsonb
where slug = 'solgar';

-- -----------------------------------------------------------------------------
-- Brands the expanded catalogue needs.
--
-- Each is a real manufacturer with genuine distribution in Europe, and **every one of them ships
-- with products in seed 13**. That is a requirement, not a coincidence: the brand list query selects
-- every brand ordered by `sort_order` with no regard for whether it has anything to sell, so an
-- unsupplied brand is a live page with an empty grid on it.
--
-- Which also gives the owner the lever for a brand it cannot supply: `is_active = false` — the read
-- policy is `is_active and deleted_at is null`, so that removes it from the storefront — **and
-- unpublish its products**, because they are filtered separately and would otherwise stay on sale
-- with a brand nobody can click through to.
-- -----------------------------------------------------------------------------
insert into brands (id, slug, name, description, country_code, website_url, sort_order, seo) values
 ('a1000000-0000-4000-8000-000000000001','nordic-naturals','Nordic Naturals',
  '{"sq":"Prodhues norvegjez-amerikan i specializuar vetëm në vaj peshku, me raport EPA:DHA të shënuar dhe testim për oksidim në secilën seri.","en":"Norwegian-American producer specialising in fish oil alone, with stated EPA:DHA ratios and per-batch oxidation testing."}'::jsonb,
  'US','https://www.nordicnaturals.com',8,
  '{"title":{"sq":"Nordic Naturals në Kosovë | BIOCODE","en":"Nordic Naturals in Kosovo | BIOCODE"},"description":{"sq":"Vaj peshku Nordic Naturals me EPA dhe DHA të shënuara për porcion.","en":"Nordic Naturals fish oil with EPA and DHA stated per serving."}}'::jsonb),

 ('a1000000-0000-4000-8000-000000000002','garden-of-life','Garden of Life',
  '{"sq":"Markë amerikane me përbërës nga ushqime të plota dhe certifikime organike e vegane. Probiotikë me shtame të emërtuara dhe CFU në skadencë.","en":"US brand built on whole-food ingredients with organic and vegan certification. Probiotics with named strains and CFU guaranteed at expiry."}'::jsonb,
  'US','https://www.gardenoflife.com',9,
  '{"title":{"sq":"Garden of Life në Kosovë | BIOCODE","en":"Garden of Life in Kosovo | BIOCODE"},"description":{"sq":"Probiotikë dhe pluhura të gjelbër Garden of Life, organike dhe vegane.","en":"Garden of Life probiotics and greens, organic and vegan."}}'::jsonb),

 ('a1000000-0000-4000-8000-000000000003','vitabiotics','Vitabiotics',
  '{"sq":"Markë britanike e formulave të synuara — Wellman, Wellwoman, Pregnacare — të zhvilluara me doza specifike për grupmosha dhe faza.","en":"UK brand of targeted formulas — Wellman, Wellwoman, Pregnacare — developed with doses specific to age groups and life stages."}'::jsonb,
  'GB','https://www.vitabiotics.com',10,
  '{"title":{"sq":"Vitabiotics në Kosovë | BIOCODE","en":"Vitabiotics in Kosovo | BIOCODE"},"description":{"sq":"Wellman, Wellwoman dhe Pregnacare nga Vitabiotics, me dërgesë në Kosovë.","en":"Vitabiotics Wellman, Wellwoman and Pregnacare delivered in Kosovo."}}'::jsonb),

 ('a1000000-0000-4000-8000-000000000004','scitec-nutrition','Scitec Nutrition',
  '{"sq":"Prodhues hungarez i nutricionit sportiv, i pranishëm në palestra në të gjithë Ballkanin. Çmim konkurrues për kilogram në whey dhe kreatinë.","en":"Hungarian sports-nutrition manufacturer, familiar in gyms across the Balkans. Competitive price per kilogram in whey and creatine."}'::jsonb,
  'HU','https://scitecnutrition.com',11,
  '{"title":{"sq":"Scitec Nutrition në Kosovë | BIOCODE","en":"Scitec Nutrition in Kosovo | BIOCODE"},"description":{"sq":"Whey, kreatinë dhe aminoacide Scitec, prodhim në BE, dërgesë në Kosovë.","en":"Scitec whey, creatine and amino acids, EU-made, delivered in Kosovo."}}'::jsonb),

 ('a1000000-0000-4000-8000-000000000005','lamberts','Lamberts',
  '{"sq":"Prodhues britanik që furnizon kryesisht profesionistë të shëndetit, me doza të sakta dhe pa aroma të shtuara.","en":"UK manufacturer supplying mainly health professionals, with exact doses and no added flavourings."}'::jsonb,
  'GB','https://www.lambertshealthcare.co.uk',12,
  '{"title":{"sq":"Lamberts në Kosovë | BIOCODE","en":"Lamberts in Kosovo | BIOCODE"},"description":{"sq":"Formula Lamberts me dozë të saktë: hekur, kalcium, gjinko.","en":"Precisely dosed Lamberts formulas: iron, calcium, ginkgo."}}'::jsonb),

 ('a1000000-0000-4000-8000-000000000006','biocode','BIOCODE',
  '{"sq":"Aksesorët dhe pakot tona. Gjëra praktike që i shtojmë vetëm kur nuk e gjejmë mirë të bërë nga të tjerët.","en":"Our own accessories and bundles. Practical things we add only when we cannot find them well made elsewhere."}'::jsonb,
  'XK','https://biocode.fit',13,
  '{"title":{"sq":"Aksesorë dhe pako BIOCODE","en":"BIOCODE accessories and bundles"},"description":{"sq":"Shaker, kuti dozimi dhe pako të kuruara nga BIOCODE.","en":"Shakers, organisers and curated bundles from BIOCODE."}}'::jsonb)
on conflict (slug) do update set
  description = excluded.description, country_code = excluded.country_code,
  website_url = excluded.website_url, sort_order = excluded.sort_order, seo = excluded.seo;

/*
 * The two BIOCODE-branded products were attached to NOW Foods.
 *
 * Seed 01 gave `biocode-shaker-600` and `pako-imuniteti` brand id `66666666-…-0001`, which is NOW
 * Foods — so the storefront credited a BIOCODE shaker and a BIOCODE bundle to an American vitamin
 * manufacturer, on the card, on the product page and in the `<meta>` tags. Nothing failed, because
 * a brand id is a brand id.
 *
 * Now that a BIOCODE brand row exists, they point at it.
 */
update products
   set brand_id = 'a1000000-0000-4000-8000-000000000006'
 where slug in ('biocode-shaker-600', 'pako-imuniteti');
