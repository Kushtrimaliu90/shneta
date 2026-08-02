-- =============================================================================
-- Content fixtures (docs/11 §9) — six articles, ten FAQs, two more banners.
--
-- The Knowledge Center, /faq and /offers are all reads over tables that were
-- empty until now, so M8 would otherwise have shipped three pages whose only
-- observable state is their empty state. These give every branch something to
-- render, in both languages.
--
-- Idempotent: fixed UUIDs plus `on conflict do update`, like the other seeds.
--
-- The bodies are markdown, deliberately exercising the whole allowlist from
-- docs/08 §3 — headings, lists, a table, a blockquote, links, emphasis and a
-- rule — because "the renderer handles tables" is otherwise untested until an
-- editor writes one in production.
--
-- Every claim is written to the docs/08 §7 rules: nutrients "contribute to"
-- and "support"; nothing here treats, cures or prevents anything.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Articles (docs/11 §9 — 6, both locales complete except where noted)
-- -----------------------------------------------------------------------------
insert into articles (
  id, slug, type, title, excerpt, body, status, published_at, reading_minutes, tags
) values
  (
    'e1000000-0000-4000-8000-000000000001',
    'si-te-zgjedhesh-proteinen-e-duhur',
    'guide',
    '{"sq":"Si të zgjedhësh proteinën e duhur","en":"How to choose the right protein"}'::jsonb,
    '{"sq":"Whey, izolat apo bimore? Një udhëzues i shkurtër për të zgjedhur sipas qëllimit dhe tolerancës.","en":"Whey, isolate or plant? A short guide to choosing by goal and tolerance."}'::jsonb,
    jsonb_build_object(
      'sq', E'## Nga çfarë varet zgjedhja\n\nProteina në pluhur nuk është një produkt i vetëm. Ndryshimet kryesore janë tri: burimi, shkalla e filtrimit dhe toleranca jote ndaj laktozës.\n\n### Krahasimi i shkurtër\n\n| Lloji | Proteina për dozë | Laktoza | Kush e zgjedh |\n| --- | --- | --- | --- |\n| Koncentrat whey | 21–24 g | E pranishme | Shumica, si zgjedhje e parë |\n| Izolat whey | 25–27 g | Gjurmë | Kush ndjen rëndim pas qumështit |\n| Bimore (bizele + oriz) | 21–24 g | Nuk ka | Dietat vegane |\n\n### Sa duhet\n\nRekomandimi i zakonshëm për dikë që stërvitet rregullisht është **1.4–2.0 g proteinë për kilogram peshë trupore në ditë**, e llogaritur nga i gjithë ushqimi i ditës — jo vetëm nga pluhuri.\n\n> Pluhuri është një mënyrë e përshtatshme për të mbyllur diferencën, jo një zëvendësim i vakteve.\n\n### Çfarë të shohësh në etiketë\n\n- Sasinë e proteinës **për dozë**, jo për 100 g\n- Nëse doza matet me lugë të nivelizuar\n- Listën e ëmbëlsuesve, nëse je i ndjeshëm\n\n---\n\nNëse nuk je i sigurt, nis me një koncentrat whey. Është forma më e provuar dhe më e lirë për gram proteine.',
      'en', E'## What the choice depends on\n\nProtein powder is not one product. Three things differ: the source, how far it has been filtered, and your own tolerance for lactose.\n\n### The short comparison\n\n| Type | Protein per serving | Lactose | Who picks it |\n| --- | --- | --- | --- |\n| Whey concentrate | 21–24 g | Present | Most people, as a first choice |\n| Whey isolate | 25–27 g | Traces | Anyone who feels heavy after dairy |\n| Plant (pea + rice) | 21–24 g | None | Vegan diets |\n\n### How much\n\nThe usual recommendation for someone training regularly is **1.4–2.0 g of protein per kilogram of body weight per day**, counted across all food — not from powder alone.\n\n> Powder is a convenient way to close the gap, not a replacement for meals.\n\n### What to look for on the label\n\n- Protein **per serving**, not per 100 g\n- Whether the scoop is measured level\n- The sweetener list, if you are sensitive to them\n\n---\n\nIf you are unsure, start with a whey concentrate. It is the best-established form and the cheapest per gram of protein.'
    ),
    'published', now() - interval '30 days', 4, '{proteina,stervitje,udhezues}'
  ),
  (
    'e1000000-0000-4000-8000-000000000002',
    'udhezues-per-vitaminen-d',
    'guide',
    '{"sq":"Udhëzues për Vitaminën D","en":"A guide to Vitamin D"}'::jsonb,
    '{"sq":"Pse bien nivelet në dimër në Kosovë, dhe si ta mbash marrjen e qëndrueshme.","en":"Why levels fall over a Kosovo winter, and how to keep intake steady."}'::jsonb,
    jsonb_build_object(
      'sq', E'## Dielli dhe gjerësia gjeografike\n\nLëkura prodhon vitaminë D kur bie drita UVB. Nga tetori deri në mars, në gjerësinë e Prishtinës, kjo dritë është shumë e dobët për pjesën më të madhe të ditës.\n\n### Sa merr zakonisht dikush\n\n- **1000–2000 IU në ditë** është intervali i zakonshëm i mirëmbajtjes\n- **4000 IU në ditë** është kufiri i sipërm i sigurt pa mbikëqyrje\n\nVitamina D kontribuon në përthithjen normale të kalciumit dhe në ruajtjen e kockave normale.\n\n### Merre me yndyrë\n\nËshtë e tretshme në yndyrë, ndaj përthithet dukshëm më mirë me një vakt që përmban pak yndyrë sesa me stomak bosh.\n\n### Kur ia vlen një analizë\n\nNjë analizë gjaku 25(OH)D të thotë ku je në të vërtetë. Ka kuptim nëse ke qëndruar gjatë brenda, nëse mbulohesh nga dielli, ose thjesht nëse do të dish në vend që të supozosh.',
      'en', E'## Sunlight and latitude\n\nSkin makes vitamin D when UVB light reaches it. From October to March, at the latitude of Prishtina, that light is too weak for most of the day.\n\n### What people usually take\n\n- **1000–2000 IU a day** is the common maintenance range\n- **4000 IU a day** is the safe upper limit without supervision\n\nVitamin D contributes to normal calcium absorption and to the maintenance of normal bones.\n\n### Take it with fat\n\nIt is fat-soluble, so it is absorbed noticeably better with a meal containing some fat than on an empty stomach.\n\n### When a test is worth it\n\nA 25(OH)D blood test tells you where you actually are. It makes sense if you have been indoors a lot, if you cover up in the sun, or simply if you would rather know than assume.'
    ),
    'published', now() - interval '25 days', 3, '{vitamina-d,dimer,udhezues}'
  ),
  (
    'e1000000-0000-4000-8000-000000000003',
    'magnezi-dhe-gjumi',
    'article',
    '{"sq":"Magnezi dhe gjumi","en":"Magnesium and sleep"}'::jsonb,
    '{"sq":"Cila formë tolerohet më mirë në mbrëmje, dhe çfarë realisht pritet prej saj.","en":"Which form is best tolerated in the evening, and what to realistically expect."}'::jsonb,
    jsonb_build_object(
      'sq', E'## Format nuk janë të njëjta\n\n**Bisglicinati** është magnez i lidhur me glicinë. Tolerohet mirë nga stomaku dhe është forma që zgjidhet zakonisht për marrje në mbrëmje. **Citrati** ka efekt më të fortë laksativ. **Oksidi** është i lirë dhe përthithet dobët.\n\nMagnezi kontribuon në funksionimin normal të muskujve dhe në reduktimin e lodhjes.\n\n### Çfarë të presësh\n\nNëse marrja jote ditore është nën rekomandimin, plotësimi i diferencës ka kuptim. Nëse është tashmë e mjaftueshme, shtimi i më shumë magnezit nuk e bën gjumin më të mirë.\n\n### Higjiena e gjumit vjen e para\n\n- Orar i njëjtë çdo natë\n- Dhomë e errët dhe e freskët\n- Pa kafeinë pas orës 14:00\n\nAsnjë suplement nuk e zëvendëson këtë listë.',
      'en', E'## The forms are not the same\n\n**Bisglycinate** is magnesium bound to glycine. It is well tolerated by the stomach and is the form usually chosen for evening use. **Citrate** has a stronger laxative effect. **Oxide** is cheap and poorly absorbed.\n\nMagnesium contributes to normal muscle function and to the reduction of tiredness.\n\n### What to expect\n\nIf your daily intake is below the recommendation, closing that gap makes sense. If it is already adequate, adding more magnesium does not make sleep better.\n\n### Sleep hygiene comes first\n\n- The same schedule every night\n- A dark, cool room\n- No caffeine after 2 pm\n\nNo supplement replaces that list.'
    ),
    'published', now() - interval '18 days', 3, '{magnez,gjumi}'
  ),
  (
    'e1000000-0000-4000-8000-000000000004',
    'smoothie-proteinik-pas-stervitjes',
    'recipe',
    '{"sq":"Smoothie proteinik pas stërvitjes","en":"Post-workout protein smoothie"}'::jsonb,
    '{"sq":"Pesë përbërës, dy minuta, rreth 30 g proteinë.","en":"Five ingredients, two minutes, about 30 g of protein."}'::jsonb,
    jsonb_build_object(
      'sq', E'## Përbërësit\n\n- 1 lugë whey (rreth 24 g proteinë)\n- 1 banane e pjekur\n- 250 ml qumësht ose pije bimore\n- 1 lugë gjelle gjalpë kikiriku\n- Një grusht akull\n\n## Përgatitja\n\n1. Hidh lëngun i pari — bluarja është më e lehtë kur bishti i blenderit nis në lëng.\n2. Shto bananen, gjalpin e kikirikut dhe akullin.\n3. Bluaj 30 sekonda.\n4. Shto pluhurin dhe bluaj edhe 15 sekonda. Duke e lënë të fundit, shmang shkumën.\n\n## Vlerat përafërsisht\n\n| | Për porcion |\n| --- | --- |\n| Proteina | ~30 g |\n| Karbohidrate | ~35 g |\n| Yndyrna | ~10 g |\n\n> Nëse e pi menjëherë pas stërvitjes ose dy orë më vonë ka rëndësi shumë më pak sesa totali i ditës.',
      'en', E'## Ingredients\n\n- 1 scoop of whey (about 24 g protein)\n- 1 ripe banana\n- 250 ml milk or a plant drink\n- 1 tablespoon peanut butter\n- A handful of ice\n\n## Method\n\n1. Pour the liquid in first — blending is easier when the blade starts in liquid.\n2. Add the banana, peanut butter and ice.\n3. Blend for 30 seconds.\n4. Add the powder and blend another 15 seconds. Adding it last avoids the foam.\n\n## Roughly\n\n| | Per serving |\n| --- | --- |\n| Protein | ~30 g |\n| Carbohydrate | ~35 g |\n| Fat | ~10 g |\n\n> Whether you drink it straight after training or two hours later matters far less than the day''s total.'
    ),
    'published', now() - interval '12 days', 2, '{receta,proteina}'
  ),
  (
    'e1000000-0000-4000-8000-000000000005',
    'cfare-thote-shkenca-per-kreatinen',
    'research',
    '{"sq":"Çfarë thotë shkenca për kreatinën","en":"What the science says about creatine"}'::jsonb,
    '{"sq":"Një përmbledhje e thjeshtë e provave për monohidratin e kreatinës, me burimet.","en":"A plain-language summary of the evidence on creatine monohydrate, with sources."}'::jsonb,
    jsonb_build_object(
      'sq', E'## Çfarë është\n\nKreatina është një përbërës që trupi e prodhon vetë dhe që merret edhe nga mishi dhe peshku. Ruhet në muskuj dhe përdoret në përpjekje të shkurtra e intensive.\n\n## Çfarë tregojnë provat\n\nMonohidrati i kreatinës është ndër suplementet më të studiuara. Provat mbështesin një rritje të vogël por të qëndrueshme të fuqisë dhe të punës totale në stërvitje me rezistencë, kur merret rregullisht.\n\n### Doza\n\n- **3–5 g në ditë**, çdo ditë, pa nevojë për fazë ngarkese\n- Koha e ditës nuk ka rëndësi të matshme\n\n### Çfarë nuk tregojnë provat\n\nNuk ka prova që kreatina dëmton veshkat te njerëzit e shëndetshëm. Nuk ka gjithashtu prova që format e shtrenjta "të avancuara" e tejkalojnë monohidratin.\n\n## Burimet\n\n- [International Society of Sports Nutrition position stand on creatine](https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0173-z)\n- [EFSA scientific opinion on creatine and muscle function](https://www.efsa.europa.eu/en/efsajournal/pub/2303)',
      'en', E'## What it is\n\nCreatine is a compound the body makes itself and also takes in from meat and fish. It is stored in muscle and used during short, intense effort.\n\n## What the evidence shows\n\nCreatine monohydrate is among the most studied supplements there is. The evidence supports a small but consistent increase in strength and total work in resistance training, when taken regularly.\n\n### Dose\n\n- **3–5 g a day**, every day, with no need for a loading phase\n- Time of day makes no measurable difference\n\n### What the evidence does not show\n\nThere is no evidence that creatine harms the kidneys in healthy people. There is also no evidence that expensive "advanced" forms outperform monohydrate.\n\n## Sources\n\n- [International Society of Sports Nutrition position stand on creatine](https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0173-z)\n- [EFSA scientific opinion on creatine and muscle function](https://www.efsa.europa.eu/en/efsajournal/pub/2303)'
    ),
    'published', now() - interval '8 days', 4, '{kreatina,shkenca}'
  ),
  (
    'e1000000-0000-4000-8000-000000000006',
    'biocode-tani-ne-kosove',
    'news',
    '{"sq":"BIOCODE tani në Kosovë","en":"BIOCODE is live in Kosovo"}'::jsonb,
    '{"sq":"Pagesa në dorëzim, dërgesa 1–3 ditë, dhe çdo përbërës i deklaruar.","en":"Cash on delivery, 1–3 day shipping, and every ingredient disclosed."}'::jsonb,
    /*
     * Albanian only, on purpose. docs/05 §7 requires the English page to fall back to the
     * Albanian body with a small "available in Albanian" note, and no seeded article
     * exercised that path — so the one piece of content most likely to stay untranslated in
     * real life is the one that tests it.
     */
    jsonb_build_object(
      'sq', E'## Jemi online\n\nBIOCODE është tani e hapur për porosi në gjithë Kosovën.\n\n### Çfarë funksionon që sot\n\n- **Pagesa në dorëzim** — paguan kur e merr paketën\n- **Dërgesa 1–3 ditë pune**, falas mbi 30 €\n- Çdo produkt me listën e plotë të përbërësve dhe %NRV\n\n### Çfarë vjen më pas\n\nAbonimet dhe programi i pikëve janë në punë e sipër. Deri atëherë, kodi **WELCOME10** ul 10% porosinë e parë.'
    ),
    'published', now() - interval '3 days', 1, '{lajme,kosove}'
  )
on conflict (id) do update
  set title = excluded.title,
      excerpt = excluded.excerpt,
      body = excluded.body,
      status = excluded.status,
      published_at = excluded.published_at,
      reading_minutes = excluded.reading_minutes,
      tags = excluded.tags;

-- -----------------------------------------------------------------------------
-- "Shop this article" links (docs/05 §7) — the product ids are from 01-catalogue.
-- -----------------------------------------------------------------------------
insert into article_products (article_id, product_id) values
  -- Protein guide → the three proteins
  ('e1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000007'),
  ('e1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000008'),
  ('e1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000009'),
  -- Vitamin D guide → the D3
  ('e1000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001'),
  -- Magnesium and sleep → magnesium and melatonin
  ('e1000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000003'),
  ('e1000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000011'),
  -- Smoothie → the whey it is built on
  ('e1000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000007'),
  -- Creatine research → both creatines
  ('e1000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-00000000000a'),
  ('e1000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-00000000000b')
on conflict do nothing;

insert into article_ingredients (article_id, ingredient_id) values
  ('e1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000a'),
  ('e1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000b'),
  ('e1000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002'),
  ('e1000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000005'),
  ('e1000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-00000000000e'),
  ('e1000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-00000000000a'),
  ('e1000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000009')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- FAQs (docs/11 §9 — 10 across five categories)
-- -----------------------------------------------------------------------------
insert into faqs (id, category, question, answer, position) values
  ('e2000000-0000-4000-8000-000000000001','porosia',
   '{"sq":"Si e bëj një porosi?","en":"How do I place an order?"}'::jsonb,
   '{"sq":"Shto produktet në shportë, plotëso adresën dhe numrin e telefonit, dhe zgjidh pagesën në dorëzim. Nuk të duhet llogari.","en":"Add the products to your basket, fill in your address and phone number, and choose cash on delivery. You do not need an account."}'::jsonb, 0),
  ('e2000000-0000-4000-8000-000000000002','porosia',
   '{"sq":"A mund ta anuloj porosinë?","en":"Can I cancel my order?"}'::jsonb,
   '{"sq":"Po, derisa të dalë nga depoja. Hyr te porositë e tua ose përdor kërkimin e porosisë me numrin dhe email-in.","en":"Yes, until it leaves the warehouse. Open your orders, or use the order lookup with your order number and email."}'::jsonb, 1),
  ('e2000000-0000-4000-8000-000000000003','dergesa',
   '{"sq":"Sa zgjat dërgesa?","en":"How long does delivery take?"}'::jsonb,
   '{"sq":"1–3 ditë pune brenda Kosovës.","en":"1–3 working days within Kosovo."}'::jsonb, 0),
  ('e2000000-0000-4000-8000-000000000004','dergesa',
   '{"sq":"Sa kushton dërgesa?","en":"How much is delivery?"}'::jsonb,
   '{"sq":"2 € standarde, falas për porositë mbi 30 €.","en":"€2 standard, free on orders over €30."}'::jsonb, 1),
  ('e2000000-0000-4000-8000-000000000005','pagesa',
   '{"sq":"A paguaj në dorëzim?","en":"Can I pay on delivery?"}'::jsonb,
   '{"sq":"Po. Pagesa në dorëzim është mënyra e vetme e pagesës për momentin — paguan me para në dorë kur ta marrësh paketën.","en":"Yes. Cash on delivery is the only payment method for now — you pay the courier when the parcel arrives."}'::jsonb, 0),
  ('e2000000-0000-4000-8000-000000000006','pagesa',
   '{"sq":"A lëshoni faturë?","en":"Do you issue an invoice?"}'::jsonb,
   '{"sq":"Po, fatura vjen bashkë me paketën dhe çmimet përfshijnë TVSH-në.","en":"Yes, the invoice comes with the parcel and all prices include VAT."}'::jsonb, 1),
  ('e2000000-0000-4000-8000-000000000007','produktet',
   '{"sq":"A janë produktet origjinale?","en":"Are the products genuine?"}'::jsonb,
   '{"sq":"Po. Furnizohemi vetëm nga distributorë të autorizuar dhe çdo produkt ka listën e plotë të përbërësve në faqen e tij.","en":"Yes. We buy only from authorised distributors, and every product lists its full ingredients on its page."}'::jsonb, 0),
  ('e2000000-0000-4000-8000-000000000008','produktet',
   '{"sq":"A mund t''i kthej produktet?","en":"Can I return products?"}'::jsonb,
   '{"sq":"Po, brenda 14 ditësh, nëse paketimi është i pahapur. Na shkruaj dhe ta organizojmë kthimin.","en":"Yes, within 14 days, if the packaging is unopened. Write to us and we will arrange the return."}'::jsonb, 1),
  ('e2000000-0000-4000-8000-000000000009','llogaria',
   '{"sq":"A më duhet llogari për të blerë?","en":"Do I need an account to buy?"}'::jsonb,
   '{"sq":"Jo. Mund të porosisësh si vizitor. Llogaria ruan adresat dhe historikun e porosive.","en":"No. You can order as a guest. An account keeps your addresses and order history."}'::jsonb, 0),
  ('e2000000-0000-4000-8000-00000000000a','llogaria',
   '{"sq":"Si e ndryshoj fjalëkalimin?","en":"How do I change my password?"}'::jsonb,
   '{"sq":"Te Llogaria → Cilësimet, ose përmes lidhjes „Harrova fjalëkalimin” në faqen e kyçjes.","en":"Under Account → Settings, or through the \"Forgot password\" link on the sign-in page."}'::jsonb, 1)
on conflict (id) do update
  set category = excluded.category,
      question = excluded.question,
      answer = excluded.answer,
      position = excluded.position;

-- -----------------------------------------------------------------------------
-- The two banners docs/11 §9 lists and seed.sql does not create.
-- -----------------------------------------------------------------------------
insert into banners (id, placement, title, subtitle, cta_label, cta_href, position) values
  ('88888888-0000-4000-8000-000000000003','home_strip',
   '{"sq":"Dërgesa falas mbi 30 €","en":"Free delivery over €30"}'::jsonb,
   '{"sq":"Brenda Kosovës, 1–3 ditë pune.","en":"Within Kosovo, 1–3 working days."}'::jsonb,
   '{"sq":"Shiko ofertat","en":"See the offers"}'::jsonb, '/offers', 0),
  ('88888888-0000-4000-8000-000000000004','offers',
   '{"sq":"Oferta të hapjes","en":"Launch offers"}'::jsonb,
   '{"sq":"Kodi WELCOME10 ul 10% porosinë e parë.","en":"Code WELCOME10 takes 10% off your first order."}'::jsonb,
   '{"sq":"Shfleto dyqanin","en":"Browse the shop"}'::jsonb, '/shop', 0)
on conflict (id) do update
  set title = excluded.title, subtitle = excluded.subtitle,
      cta_label = excluded.cta_label, cta_href = excluded.cta_href;
