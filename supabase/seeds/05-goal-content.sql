-- ---------------------------------------------------------------------------------------------
-- Health-goal intros (docs/05 §5) — the 16 SEO landing pages.
--
-- Written to replace the `[CONTENT: replace]` markers `seed.sql` inserts. Kept in its own seed
-- file rather than inlined there because `sql_paths` runs `seed.sql` first and `seeds/*.sql`
-- after it, so the rows exist by the time these statements run — on a fresh `db reset` *and* on
-- the linked project, which receives this through `pnpm db:seed:linked`. One source of truth for
-- both, which is the whole reason it is not a migration.
--
-- **Every update is guarded on the placeholder still being there.** Once a content manager edits
-- a description in the admin, re-running the seed leaves it alone. That is the same reasoning as
-- `seed.sql`'s own `on conflict` clauses deliberately not touching `description` and `body`:
-- seed data may create content, never overwrite someone's work.
--
-- ---------------------------------------------------------------------------------------------
-- Compliance (docs/08 §7) — read before editing any of this.
--
-- These are health claims about food supplements, not medicines. The copy describes what a
-- nutrient *contributes to* in normal physiology; it never says anything is fixed, avoided or
-- made to go away. The banned-verb list in `src/lib/claims.ts` is asserted against the BioHack
-- ruleset in `tests/integration/biohack.test.ts`, and the same discipline applies here.
--
-- Written by engineering as launch copy. A qualified reviewer should still read it before this
-- shop takes real orders — see docs/14 §14.
-- ---------------------------------------------------------------------------------------------

update health_goals set description = jsonb_build_object('sq', $md$
Energjia e përditshme nuk vjen nga një burim i vetëm. Ajo varet nga gjumi, nga ushqimi, nga sa lëvizim dhe nga sa mirë trupi e kthen atë që hamë në karburant për qelizat. Kur ndihesh vazhdimisht i lodhur, zakonisht nuk është një gjë e vetme që mungon.

Disa lëndë ushqyese kanë një rol të njohur në metabolizmin normal të energjisë. Vitaminat B — veçanërisht B12, B6 dhe folati — kontribuojnë në metabolizmin normal energjetik dhe në zvogëlimin e lodhjes. Hekuri kontribuon në transportin normal të oksigjenit në trup. Magnezi merr pjesë në qindra reaksione qelizore, përfshirë ato që lidhen me energjinë.

Këtu do të gjesh produktet që lidhen me këtë qëllim, me përbërësit e deklaruar dhe dozat e shkruara qartë. Nëse lodhja është e vazhdueshme ose e papritur, bisedo me mjekun para se të shtosh çfarëdo suplementi — ka shkaqe që një suplement nuk i adreson.

Si të fillosh: shiko gjumin dhe vaktet para se të shtosh diçka — një mëngjes me proteinë dhe një orar i qëndrueshëm gjumi bëjnë më shumë sesa pritet. Nëse do një pikënisje të përshtatur, gjeneratori BioHack të ndërton një protokoll në më pak se një minutë, me arsyen pse secili artikull hyri.
$md$, 'en', $md$
Everyday energy does not come from one place. It depends on sleep, on food, on how much you move, and on how well your body turns what you eat into fuel for your cells. When you feel tired all the time, it is rarely one single thing that is missing.

Several nutrients have a recognised role in normal energy metabolism. The B vitamins — B12, B6 and folate in particular — contribute to normal energy-yielding metabolism and to the reduction of tiredness and fatigue. Iron contributes to normal oxygen transport in the body. Magnesium takes part in hundreds of cellular reactions, including those involved in energy.

Here you will find the products associated with this goal, with declared ingredients and dosages written plainly. If your tiredness is persistent or sudden, talk to a doctor before adding any supplement — there are causes a supplement does not address.

Where to start: look at sleep and meals before adding anything — a breakfast with protein and a steady sleep schedule do more than people expect. If you want a tailored starting point, the BioHack generator builds a protocol in under a minute, with the reason each item is in it.
$md$)
where slug = 'energji' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Gjumi i mirë nuk matet vetëm me orë. Rëndësi ka sa shpejt e zë gjumi, sa herë zgjohesh gjatë natës dhe si ndihesh në mëngjes. Rutina para gjumit shpesh ndikon më shumë se çdo gjë tjetër: drita e ekraneve, kafeina pasdite dhe një orar i parregullt janë tri gjërat që dalin më së shpeshti.

Magnezi kontribuon në funksionimin normal të sistemit nervor dhe në funksionimin normal psikologjik. Melatonina ndihmon në zvogëlimin e kohës që duhet për të fjetur — një efekt i njohur kur merret afër kohës së gjumit. Bimë si bliri dhe valeriana përdoren prej kohësh në rutinat e mbrëmjes.

Produktet e listuara këtu lidhen me këtë qëllim. Doza dhe koha e marrjes janë të shkruara në etiketë dhe në faqen e secilit produkt. Nëse problemet me gjumin zgjasin javë të tëra, ia vlen ta ngresh temën me mjekun.

Si të fillosh: mbaj të njëjtën orë zgjimi shtatë ditë në javë për dy javë dhe shiko çfarë ndryshon — kjo është ndërhyrja e vetme që ndikon më shumë. Pastaj, nëse do një pikënisje të përshtatur, gjeneratori BioHack të ndërton një protokoll për mbrëmjen, me kohën e marrjes për secilin artikull.
$md$, 'en', $md$
Good sleep is not measured in hours alone. What matters is how quickly you fall asleep, how often you wake in the night, and how you feel in the morning. The routine before bed often matters more than anything else: screen light, afternoon caffeine and an irregular schedule are the three that come up most.

Magnesium contributes to normal functioning of the nervous system and to normal psychological function. Melatonin contributes to the reduction of time taken to fall asleep — a recognised effect when it is taken close to bedtime. Herbs such as lime flower and valerian have long been part of evening routines.

The products listed here are associated with this goal. Dosage and timing are on the label and on each product page. If sleep problems last for weeks, it is worth raising with a doctor.

Where to start: keep the same wake time seven days a week for a fortnight and see what changes — it is the single intervention with the largest effect. After that, if you want a tailored starting point, the BioHack generator builds an evening protocol with the timing for each item.
$md$)
where slug = 'gjumi' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Sistemi imunitar punon çdo ditë, jo vetëm në dimër. Ai mbështetet nga gjëra të thjeshta dhe të mërzitshme: gjumi i mjaftueshëm, ushqimi i larmishëm, lëvizja dhe menaxhimi i stresit afatgjatë. Suplementet hyjnë aty ku dieta lë boshllëqe.

Vitamina C kontribuon në funksionimin normal të sistemit imunitar dhe në mbrojtjen e qelizave nga stresi oksidativ. Vitamina D ka të njëjtin rol të njohur për imunitetin — dhe në gjerësinë tonë gjeografike, nivelet bien natyrshëm gjatë muajve me pak diell. Zinku kontribuon gjithashtu në funksionimin normal të sistemit imunitar; merret më mirë me ushqim, sepse esëll mund të shkaktojë siklet në stomak.

Këtu janë produktet që lidhen me këtë qëllim. Asnjë suplement nuk e zëvendëson një dietë të mirë ose një vizitë te mjeku kur diçka nuk shkon.

Si të fillosh: në muajt nga tetori deri në mars, vitamina D është pyetja e parë që ia vlen t’i bëhet mjekut, sepse një analizë e thjeshtë gjaku e tregon nivelin tënd. Gjeneratori BioHack e merr parasysh dietën dhe medikamentet e tua para se të propozojë çfarëdo gjëje.
$md$, 'en', $md$
The immune system works every day, not only in winter. It is supported by simple, unglamorous things: enough sleep, varied food, movement, and keeping long-term stress in check. Supplements come in where the diet leaves gaps.

Vitamin C contributes to the normal function of the immune system and to the protection of cells from oxidative stress. Vitamin D has the same recognised role for immunity — and at our latitude, levels fall naturally through the months with little sun. Zinc also contributes to normal immune function; it is better taken with food, since on an empty stomach it can cause discomfort.

These are the products associated with this goal. No supplement replaces a good diet, or a visit to the doctor when something is wrong.

Where to start: between October and March, vitamin D is the first question worth asking your doctor, since a simple blood test shows your level. The BioHack generator takes your diet and medication into account before it suggests anything at all.
$md$)
where slug = 'imuniteti' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Stresi nuk është gjithmonë i keq — problemi fillon kur nuk ndalet. Ditët e ngarkuara njëra pas tjetrës prekin gjumin, tretjen, përqendrimin dhe humorin, dhe shpesh e vërejmë vetëm kur trupi e thotë të parin.

Magnezi kontribuon në funksionimin normal psikologjik dhe në funksionimin normal të sistemit nervor. Ashwagandha përdoret prej kohësh në traditën ajurvedike si bimë adaptogjene dhe sot është një nga përbërësit më të kërkuar në këtë kategori. Vitaminat B mbështesin funksionimin normal të sistemit nervor.

Përpara se të shtosh diçka: gjumi i rregullt, koha larg ekraneve dhe lëvizja e përditshme bëjnë punë që asnjë kapsulë nuk e bën. Produktet këtu janë mbështetje, jo zgjidhje. Nëse stresi po ndikon ndjeshëm në jetën e përditshme, flit me një profesionist shëndetësor — dhe sidomos nëse merr medikamente të rregullta.

Si të fillosh: dhjetë minuta ecje jashtë pas drekës është ndryshimi më i vogël me efektin më të madh, dhe nuk kushton asgjë. Nëse do një pikënisje të përshtatur, gjeneratori BioHack të pyet për medikamentet përpara se të propozojë ndonjë bimë adaptogjene — sepse aty ndërveprimet janë reale.
$md$, 'en', $md$
Stress is not always bad — the problem starts when it does not stop. Busy days stacked one after another reach into sleep, digestion, concentration and mood, and we often notice only when the body says so first.

Magnesium contributes to normal psychological function and to normal functioning of the nervous system. Ashwagandha has long been used in the Ayurvedic tradition as an adaptogenic herb and is now among the most asked-for ingredients in this category. The B vitamins support normal nervous system function.

Before adding anything: regular sleep, time away from screens and daily movement do work that no capsule does. The products here are support, not a solution. If stress is noticeably affecting daily life, speak to a health professional — and especially so if you take regular medication.

Where to start: ten minutes walking outdoors after lunch is the smallest change with the largest effect, and it costs nothing. If you want a tailored starting point, the BioHack generator asks about medication before suggesting any adaptogenic herb — because that is where interactions are real.
$md$)
where slug = 'stresi' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Përqendrimi ndryshon gjatë ditës dhe varet nga gjumi, nga hidratimi, nga sa pushime marrim dhe nga sa gjëra kërkojnë vëmendjen tonë njëkohësisht. Puna me ekran e bën këtë më të vështirë sesa duket.

Disa lëndë ushqyese kanë role të njohura këtu. Acidet yndyrore omega-3, veçanërisht DHA, kontribuojnë në funksionimin normal të trurit kur merren rregullisht. Vitaminat B kontribuojnë në funksionimin normal psikologjik. Kolina kontribuon në metabolizmin normal të homocisteinës dhe në funksionimin normal të mëlçisë. Kreatina është studiuar gjerësisht te sportistët dhe po studiohet edhe për performancën njohëse.

Kafeina vepron shpejt dhe të gjithë e njohin; e vlen të mbahet mend se ora e fundit e kafesë ndikon te gjumi i asaj nate, dhe gjumi i keq e kthen problemin nga e para. Produktet këtu lidhen me këtë qëllim.

Si të fillosh: mat një gjë për dy javë — për shembull sa gjatë punon pa e prekur telefonin — para se të ndryshosh çfarëdo tjetër. Gjeneratori BioHack të jep një listë matjesh bashkë me protokollin, që të kesh një pikënisje me të cilën të krahasosh.
$md$, 'en', $md$
Focus changes through the day and depends on sleep, hydration, how many breaks you take, and how many things are asking for your attention at once. Screen work makes this harder than it looks.

Several nutrients have recognised roles here. Omega-3 fatty acids, DHA in particular, contribute to normal brain function when taken regularly. The B vitamins contribute to normal psychological function. Choline contributes to normal homocysteine metabolism and normal liver function. Creatine has been studied extensively in athletes and is now being studied for cognitive performance too.

Caffeine works quickly and everyone knows it; it is worth remembering that the hour of your last coffee reaches into that night's sleep, and poor sleep starts the problem over. The products here are associated with this goal.

Where to start: measure one thing for a fortnight — how long you work without touching your phone, for instance — before changing anything else. The BioHack generator gives you a short list of measures alongside the protocol, so you have a baseline to compare against.
$md$)
where slug = 'truri' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Shëndeti kardiovaskular ndërtohet me vite, nga gjërat që bëjmë çdo javë: lëvizja, ushqimi, duhani, gjumi dhe stresi. Asnjë suplement nuk e zë vendin e tyre, dhe kushdo që thotë ndryshe po shet diçka.

Disa lëndë ushqyese kanë role të njohura. EPA dhe DHA — acidet yndyrore omega-3 nga peshku — kontribuojnë në funksionimin normal të zemrës kur merren në sasi të mjaftueshme ditore. Koenzima Q10 gjendet natyrshëm në indet me kërkesa të larta energjie. Kaliumi kontribuon në ruajtjen e presionit normal të gjakut, dhe magnezi në funksionimin normal të muskujve, përfshirë muskulin e zemrës.

Nëse merr ilaçe për presionin, për kolesterolin ose antikoagulantë, bisedo me mjekun para se të shtosh omega-3 ose çdo gjë tjetër: ndërveprimet janë reale dhe të njohura. Produktet e kësaj kategorie janë listuar më poshtë.

Si të fillosh: kontrollet e rregullta të presionit dhe të lipideve janë më të vlefshme se çdo produkt në këtë faqe, dhe në Kosovë bëhen shpejt e lirë. Gjeneratori BioHack e merr parasysh nëse merr medikamente të rregullta dhe i heq përbërësit me ndërveprime të njohura.
$md$, 'en', $md$
Cardiovascular health is built over years, out of the things we do every week: movement, food, tobacco, sleep and stress. No supplement takes their place, and anyone who says otherwise is selling something.

Several nutrients have recognised roles. EPA and DHA — the omega-3 fatty acids from fish — contribute to the normal function of the heart when taken in sufficient daily amounts. Coenzyme Q10 occurs naturally in tissues with high energy demand. Potassium contributes to the maintenance of normal blood pressure, and magnesium to normal muscle function, including the heart muscle.

If you take blood-pressure medication, cholesterol medication or anticoagulants, talk to your doctor before adding omega-3 or anything else: the interactions are real and well documented. The products in this category are listed below.

Where to start: regular blood-pressure and lipid checks are worth more than any product on this page, and in Kosovo they are quick and inexpensive. The BioHack generator takes account of whether you take regular medication and removes ingredients with known interactions.
$md$)
where slug = 'zemra' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Kockat janë ind i gjallë që rinovohet vazhdimisht. Dendësia e tyre ndërtohet kryesisht deri në fund të të njëzetave dhe ruhet më pas — me ushqyerje, me lëvizje që mban peshë, dhe me mjaftueshëm nga dy-tri lëndë ushqyese që rrallë i marrim me tepricë.

Kalciumi është nevojshëm për ruajtjen e kockave normale. Vitamina D kontribuon në thithjen dhe përdorimin normal të kalciumit dhe në ruajtjen e kockave normale — dhe pikërisht kjo është arsyeja pse të dyja shpesh merren bashkë. Vitamina K2 kontribuon gjithashtu në ruajtjen e kockave normale. Magnezi merr pjesë në të njëjtin sistem.

Në muajt me pak diell, vitamina D vjen kryesisht nga ushqimi dhe suplementet. Produktet e listuara këtu lidhen me këtë qëllim; dozat janë në etiketë dhe në faqen e produktit.

Si të fillosh: lëvizja që mban peshë — ecja, ngjitja e shkallëve, stërvitja me rezistencë — është pjesa që asnjë suplement nuk e zëvendëson, dhe funksionon në çdo moshë. Gjeneratori BioHack e ndërton protokollin rreth saj dhe të tregon çfarë të matësh pas njëzet e tetë ditësh.
$md$, 'en', $md$
Bone is living tissue that renews continuously. Its density is built mostly by the end of your twenties and maintained after that — through nutrition, through weight-bearing movement, and through getting enough of two or three nutrients we rarely take in excess.

Calcium is needed for the maintenance of normal bones. Vitamin D contributes to the normal absorption and utilisation of calcium and to the maintenance of normal bones — which is exactly why the two are so often taken together. Vitamin K2 also contributes to the maintenance of normal bones. Magnesium takes part in the same system.

Through the months with little sun, vitamin D comes mainly from food and supplements. The products listed here are associated with this goal; dosages are on the label and on each product page.

Where to start: weight-bearing movement — walking, stairs, resistance training — is the part no supplement replaces, and it works at any age. The BioHack generator builds the protocol around that and tells you what to measure after twenty-eight days.
$md$)
where slug = 'kockat' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Nyjet i ndiejmë kur pushojnë së punuari pa u vënë re — pas një stërvitjeje të re, pas viteve me të njëjtën lëvizje të përsëritur, ose thjesht në ditët e ftohta. Lëvizja e rregullt dhe pesha e qëndrueshme janë dy gjërat që ndihmojnë më shumë.

Kolagjeni është proteina kryesore strukturore e indit lidhor dhe një nga përbërësit më të kërkuar në këtë kategori. Vitamina C kontribuon në formimin normal të kolagjenit për funksionimin normal të kërcit dhe të kockave — prandaj shpesh shoqërohen. Glukozamina dhe kondroitina përdoren prej dekadash në këtë fushë. Omega-3 është një tjetër përbërës i njohur këtu.

Nëse dhembja është e fortë, e vazhdueshme ose shoqërohet me ënjtje, kjo është një bisedë për mjekun, jo për një suplement. Produktet e kësaj kategorie janë listuar më poshtë.

Si të fillosh: ndrysho një gjë në rutinën e stërvitjes para se të shtosh një produkt — vëllimi i rritur shumë shpejt është shkaku më i zakonshëm. Nëse do një pikënisje të përshtatur, gjeneratori BioHack të ndërton një protokoll me faza, ku bazat vijnë të parat.
$md$, 'en', $md$
You notice your joints when they stop working unnoticed — after a new kind of training, after years of the same repeated movement, or simply on cold days. Regular movement and a steady weight are the two things that help most.

Collagen is the main structural protein of connective tissue and one of the most asked-for ingredients in this category. Vitamin C contributes to normal collagen formation for the normal function of cartilage and bones — which is why the two are so often paired. Glucosamine and chondroitin have been used in this area for decades. Omega-3 is another familiar ingredient here.

If pain is severe, persistent, or comes with swelling, that is a conversation for a doctor rather than for a supplement. The products in this category are listed below.

Where to start: change one thing in your training routine before adding a product — volume increased too quickly is the most common cause. If you want a tailored starting point, the BioHack generator builds a phased protocol where the basics come first.
$md$)
where slug = 'nyjet' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Nevojat ushqyese të grave ndryshojnë me fazat e jetës, dhe ndryshojnë mjaft. Adoleshenca, vitet riprodhuese, shtatzënia, gjidhënia dhe menopauza kërkojnë secila diçka pak të ndryshme, dhe një produkt i vetëm rrallë u përgjigjet të gjithave.

Hekuri kontribuon në formimin normal të qelizave të kuqe të gjakut dhe të hemoglobinës, dhe humbjet mujore e bëjnë atë një temë të shpeshtë. Folati kontribuon në rritjen normale të indeve amtare gjatë shtatzënisë. Kalciumi dhe vitamina D kontribuojnë në ruajtjen e kockave normale, gjë që merr më shumë peshë pas menopauzës. Magnezi kontribuon në zvogëlimin e lodhjes.

Nëse je shtatzënë ose me gjidhënie, mos shto asnjë suplement pa e pyetur mjekun ose farmacistin — kjo është një nga situatat ku këshilla e përgjithshme nuk mjafton. Produktet e listuara këtu lidhen me këtë qëllim.

Si të fillosh: një analizë gjaku për hekurin dhe vitaminën D u përgjigjet shumicës së pyetjeve në këtë kategori, dhe e bën përgjigjen konkrete në vend se të hamendësuar. Gjeneratori BioHack nuk propozon asgjë nëse je shtatzënë ose me gjidhënie — atë protokoll e ndërton vetëm një profesionist.
$md$, 'en', $md$
Women's nutritional needs change with the stages of life, and they change considerably. Adolescence, the reproductive years, pregnancy, breastfeeding and menopause each ask for something slightly different, and a single product rarely answers all of them.

Iron contributes to the normal formation of red blood cells and haemoglobin, and monthly losses make it a frequent topic. Folate contributes to normal maternal tissue growth during pregnancy. Calcium and vitamin D contribute to the maintenance of normal bones, which carries more weight after menopause. Magnesium contributes to the reduction of tiredness and fatigue.

If you are pregnant or breastfeeding, do not add any supplement without asking your doctor or pharmacist — this is one of the situations where general advice is not enough. The products listed here are associated with this goal.

Where to start: a blood test for iron and vitamin D answers most of the questions in this category, and makes the answer specific rather than guessed. The BioHack generator suggests nothing at all if you are pregnant or breastfeeding — that protocol is a professional’s to build.
$md$)
where slug = 'shendeti-i-gruas' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Kërkesat ndryshojnë me moshën dhe me nivelin e aktivitetit, por temat që dalin më shpesh janë të njëjtat: energjia gjatë ditës, mbajtja e masës muskulore, shëndeti kardiovaskular dhe gjumi.

Zinku kontribuon në ruajtjen e niveleve normale të testosteronit në gjak dhe në fertilitetin e riprodhimin normal. Magnezi kontribuon në funksionimin normal të muskujve dhe në zvogëlimin e lodhjes. Vitamina D ka role të njohura për muskujt, kockat dhe imunitetin. Për ata që stërviten rregullisht, proteina kontribuon në rritjen dhe ruajtjen e masës muskulore, dhe kreatina është një nga përbërësit më të studiuar në sport.

Suplementet nuk e zëvendësojnë stërvitjen, gjumin ose ushqimin — ato mbushin boshllëqe. Nëse merr medikamente të rregullta, kontrolloji ndërveprimet me farmacistin. Produktet e kësaj kategorie janë më poshtë.

Si të fillosh: dy seanca stërvitjeje me rezistencë në javë dhe shtatë orë gjumë ndryshojnë më shumë se çdo kombinim suplementesh, dhe janë edhe të matshme. Gjeneratori BioHack të ndërton një protokoll rreth qëllimeve që zgjedh dhe të tregon çmimin mujor përpara se të vendosësh.
$md$, 'en', $md$
Requirements shift with age and activity level, but the topics that come up most are the same ones: energy through the day, holding on to muscle mass, cardiovascular health, and sleep.

Zinc contributes to the maintenance of normal testosterone levels in the blood and to normal fertility and reproduction. Magnesium contributes to normal muscle function and to the reduction of tiredness and fatigue. Vitamin D has recognised roles for muscle, bone and immunity. For anyone training regularly, protein contributes to the growth and maintenance of muscle mass, and creatine is among the most studied ingredients in sport.

Supplements do not replace training, sleep or food — they fill gaps. If you take regular medication, check interactions with your pharmacist. The products in this category are below.

Where to start: two resistance sessions a week and seven hours of sleep change more than any combination of supplements, and they are measurable too. The BioHack generator builds a protocol around the goals you choose and shows the monthly cost before you decide.
$md$)
where slug = 'shendeti-i-burrit' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Tretja ndikon në më shumë sesa mendojmë — në energji, në humor, në sa mirë i thithim lëndët ushqyese që hamë. Fibrat, uji, ritmi i vakteve dhe stresi janë katër faktorët që dalin më shpesh, dhe zakonisht ndryshimi i njërit prej tyre ndihet.

Probiotikët janë mikroorganizma të gjallë që shtohen te flora ekzistuese e zorrëve; llojet dhe sasitë ndryshojnë shumë nga produkti në produkt, prandaj ia vlen të lexohet etiketa. Prebiotikët janë fibrat me të cilat ato ushqehen. Enzimat tretëse përdoren nga disa njerëz me vakte të rënda. Glutamina është një aminoacid i pranishëm natyrshëm në mukozën e zorrëve.

Nëse ke simptoma të vazhdueshme — dhembje, ndryshime të papritura, ose gjak — kjo kërkon mjek, jo suplement. Produktet e kësaj kategorie janë listuar më poshtë.

Si të fillosh: shto fibra ngadalë dhe pi më shumë ujë ndërkohë — një rritje e shpejtë e fibrave është arsyeja më e zakonshme pse njerëzit heqin dorë në javën e parë. Gjeneratori BioHack e merr parasysh dietën tënde dhe propozon vetëm produkte që i përshtaten.
$md$, 'en', $md$
Digestion reaches further than we tend to think — into energy, into mood, into how well we absorb the nutrients we eat. Fibre, water, meal rhythm and stress are the four factors that come up most, and changing one of them is usually noticeable.

Probiotics are live microorganisms added to the gut flora you already have; strains and amounts vary enormously between products, so the label is worth reading. Prebiotics are the fibres they feed on. Digestive enzymes are used by some people with heavy meals. Glutamine is an amino acid naturally present in the gut lining.

If you have persistent symptoms — pain, sudden changes, or blood — that needs a doctor, not a supplement. The products in this category are listed below.

Where to start: add fibre slowly and drink more water while you do — a fast increase is the most common reason people give up in the first week. The BioHack generator takes your diet into account and only suggests products that match it.
$md$)
where slug = 'tretja' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Menaxhimi i peshës është çështje e bilancit të energjisë, e gjumit, e proteinës në dietë dhe e zakoneve që mbahen për muaj — jo e një produkti. Ky është një nga sektorët ku premtimet janë më të mëdha dhe dëshmitë më të vogla, prandaj po e themi qartë që në fillim.

Disa lëndë ushqyese kanë role të njohura në metabolizmin normal. Proteina kontribuon në ruajtjen e masës muskulore, e cila ka rëndësi kur pesha ndryshon. Fibrat ndihmojnë ndjesinë e ngopjes në një vakt. Kromi kontribuon në metabolizmin normal të makronutrientëve dhe në ruajtjen e niveleve normale të glukozës në gjak. Çaji jeshil dhe L-karnitina janë përbërës të kërkuar shpesh në këtë kategori.

Asnjë nga këto nuk zëvendëson një dietë të qëndrueshme dhe lëvizjen. Nëse ke një gjendje shëndetësore ose merr medikamente, bisedo me mjekun para se të fillosh.

Si të fillosh: mat proteinën dhe hapat për dy javë para se të blesh çfarëdo gjëje — shumica e njerëzve zbulojnë se njëra prej të dyjave është shumë më e ulët sesa mendonin. Gjeneratori BioHack të lejon të vendosësh një buxhet mujor dhe nuk e kalon atë pa ta thënë.
$md$, 'en', $md$
Weight management is a matter of energy balance, sleep, dietary protein and habits held for months — not of a product. This is one of the categories where the promises are largest and the evidence smallest, so we would rather say so up front.

Some nutrients have recognised roles in normal metabolism. Protein contributes to the maintenance of muscle mass, which matters while weight is changing. Fibre supports the feeling of fullness within a meal. Chromium contributes to normal macronutrient metabolism and to the maintenance of normal blood glucose levels. Green tea and L-carnitine are frequently asked-for ingredients in this category.

None of this replaces a sustainable diet and movement. If you have a health condition or take medication, talk to your doctor before starting.

Where to start: track protein and step count for a fortnight before buying anything — most people find one of the two is far lower than they thought. The BioHack generator lets you set a monthly budget and will not exceed it without telling you.
$md$)
where slug = 'pesha' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Flokët rriten në cikle, dhe cikli është i gjatë: ndryshimet në ushqyerje ose në rutinë duken zakonisht pas dy deri në tre muajsh, jo pas dy javësh. Kjo është arsyeja pse durimi është pjesa më e vështirë e kësaj kategorie.

Biotina kontribuon në ruajtjen e flokëve normale. Zinku kontribuon gjithashtu në ruajtjen e flokëve normale. Selen ka të njëjtin rol të njohur. Hekuri kontribuon në transportin normal të oksigjenit, dhe nivelet e ulëta janë një temë e shpeshtë kur flokët ndryshojnë. Kolagjeni dhe proteina japin aminoacidet nga të cilat ndërtohet fija.

Nëse rënia është e shpejtë, në njolla, ose e shoqëruar me simptoma të tjera, ia vlen një vizitë te mjeku para se të provosh diçka nga rafti. Produktet e listuara këtu lidhen me këtë qëllim.

Si të fillosh: bëj një fotografi sot dhe një tjetër pas tre muajsh, sepse kujtesa jonë është e keqe për ndryshime kaq të ngadalta. Gjeneratori BioHack të jep një listë matjesh bashkë me protokollin, pikërisht për këtë arsye, dhe të kujton çfarë të shikosh.
$md$, 'en', $md$
Hair grows in cycles, and the cycle is long: changes in nutrition or routine usually show after two to three months, not two weeks. That is what makes patience the hardest part of this category.

Biotin contributes to the maintenance of normal hair. Zinc also contributes to the maintenance of normal hair. Selenium has the same recognised role. Iron contributes to normal oxygen transport, and low levels are a frequent topic when hair changes. Collagen and protein supply the amino acids the strand is built from.

If loss is rapid, patchy, or comes with other symptoms, a visit to the doctor is worth more than anything from a shelf. The products listed here are associated with this goal.

Where to start: take a photograph today and another in three months, because our memory is poor at changes this slow. The BioHack generator gives you a short list of measures alongside the protocol for exactly this reason, and tells you what to look at.
$md$)
where slug = 'floket' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Lëkura reflekton shumë gjëra njëherësh: gjumin, hidratimin, ekspozimin ndaj diellit, moshën dhe ushqyerjen. Ajo është organi më i madh i trupit dhe rinovohet vazhdimisht, që do të thotë se ka nevojë të qëndrueshme për lëndë ndërtuese.

Vitamina C kontribuon në formimin normal të kolagjenit për funksionimin normal të lëkurës, dhe njëkohësisht në mbrojtjen e qelizave nga stresi oksidativ. Biotina kontribuon në ruajtjen e lëkurës normale. Zinku ka të njëjtin rol të njohur. Kolagjeni si suplement është një nga përbërësit më të kërkuar sot. Acidi hialuronik dhe omega-3 janë gjithashtu të zakonshëm në këtë kategori.

Kremi i diellit dhe gjumi bëjnë punë që asnjë kapsulë nuk e bën. Produktet e listuara këtu lidhen me këtë qëllim; përbërësit dhe dozat janë të deklaruara në secilën faqe.

Si të fillosh: krem dielli çdo ditë, edhe në dimër, është hapi i vetëm me dëshmi më të forta se çdo gjë tjetër në këtë faqe. Nëse do një pikënisje të përshtatur, gjeneratori BioHack të ndërton një protokoll dhe e ndan atë sipas kohës së ditës.
$md$, 'en', $md$
Skin reflects several things at once: sleep, hydration, sun exposure, age and nutrition. It is the body's largest organ and renews continuously, which means a steady demand for building material.

Vitamin C contributes to normal collagen formation for the normal function of skin, and at the same time to the protection of cells from oxidative stress. Biotin contributes to the maintenance of normal skin. Zinc has the same recognised role. Collagen as a supplement is one of the most asked-for ingredients today. Hyaluronic acid and omega-3 are also common in this category.

Sunscreen and sleep do work that no capsule does. The products listed here are associated with this goal; ingredients and dosages are declared on every page.

Where to start: sunscreen every day, winter included, is the one step with stronger evidence behind it than anything else on this page. If you want a tailored starting point, the BioHack generator builds a protocol and splits it by time of day.
$md$)
where slug = 'lekura' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Thonjtë rriten ngadalë — rreth tre milimetra në muaj për duart, dhe më ngadalë për këmbët. Si te flokët, çdo ndryshim duket vetëm pas disa muajsh, dhe pjesa e re rritet nga baza ndërsa pjesa e vjetër del jashtë.

Biotina kontribuon në ruajtjen e thonjve normalë dhe është përbërësi më i njohur në këtë kategori. Zinku kontribuon në ruajtjen e thonjve normalë dhe në sintezën normale të proteinave. Selen kontribuon në ruajtjen e thonjve normalë. Kolagjeni dhe proteina japin aminoacidet bazë; hekuri hyn në lojë kur ka mungesa.

Thonjtë që thyhen shpesh mund të reflektojnë thjesht kontakt të tepërt me ujin dhe detergjentët. Nëse ndryshimet janë të papritura ose të forta në formë e ngjyrë, ia vlen të pyetet mjeku. Produktet e kësaj kategorie janë më poshtë.

Si të fillosh: doreza kur lan enët dhe një kremë duarsh pas çdo larjeje zgjidhin më shumë raste sesa pritet, dhe kushtojnë pak. Gjeneratori BioHack të ndërton një protokoll rreth qëllimeve që zgjedh dhe të thotë sa kohë duhet para se të presësh një ndryshim.
$md$, 'en', $md$
Nails grow slowly — around three millimetres a month on the hands, and slower on the feet. As with hair, any change shows only after several months, with the new part growing from the base while the old part travels out.

Biotin contributes to the maintenance of normal nails and is the best-known ingredient in this category. Zinc contributes to the maintenance of normal nails and to normal protein synthesis. Selenium contributes to the maintenance of normal nails. Collagen and protein supply the basic amino acids; iron comes into play where there are deficiencies.

Nails that break often may simply reflect too much contact with water and detergents. If changes in shape or colour are sudden or pronounced, it is worth asking a doctor. The products in this category are below.

Where to start: gloves for washing up and a hand cream after every wash resolve more cases than people expect, and cost little. The BioHack generator builds a protocol around the goals you choose and says how long to wait before expecting a change.
$md$)
where slug = 'thonjte' and description->>'sq' like '[CONTENT: replace]%';

update health_goals set description = jsonb_build_object('sq', $md$
Plakja e shëndetshme nuk ka të bëjë me ngadalësimin e orës, por me ruajtjen e asaj që kemi: forcën, lëvizshmërinë, kthjelltësinë dhe pavarësinë. Ato ndërtohen me dekada, dhe zakonet e viteve të mesme numërojnë më shumë se çdo produkt.

Disa lëndë ushqyese kanë role të njohura. Vitamina D dhe kalciumi kontribuojnë në ruajtjen e kockave normale. Proteina kontribuon në ruajtjen e masës muskulore, e cila bie natyrshëm me moshën dhe mbrohet me lëvizje kundër rezistencës. Omega-3 kontribuon në funksionimin normal të trurit dhe të zemrës. Vitamina B12 mbështet funksionimin normal të sistemit nervor, dhe thithja e saj ulet natyrshëm pas moshës së pesëdhjetë. Koenzima Q10 dhe resveratroli janë përbërës të kërkuar shpesh në këtë kategori.

Kontrollet e rregullta mjekësore janë pjesa më e vlefshme e kësaj liste. Produktet e lidhura me këtë qëllim janë më poshtë.

Si të fillosh: forca e shtrëngimit të dorës dhe koha që rri në një këmbë janë dy matje falas që tregojnë shumë, dhe mund t’i përsëritësh çdo muaj. Gjeneratori BioHack e ndërton protokollin rreth qëllimeve që zgjedh dhe të jep matjet përkatëse për secilin.
$md$, 'en', $md$
Healthy ageing is not about slowing the clock; it is about keeping what we have — strength, mobility, clarity and independence. Those are built over decades, and the habits of middle age count for more than any product.

Several nutrients have recognised roles. Vitamin D and calcium contribute to the maintenance of normal bones. Protein contributes to the maintenance of muscle mass, which declines naturally with age and is protected by resistance movement. Omega-3 contributes to normal brain and heart function. Vitamin B12 supports normal nervous system function, and its absorption falls naturally after fifty. Coenzyme Q10 and resveratrol are frequently asked-for ingredients in this category.

Regular medical check-ups are the most valuable item on this list. The products associated with this goal are below.

Where to start: grip strength and how long you can stand on one leg are two free measures that say a great deal, and you can repeat them monthly. The BioHack generator builds the protocol around the goals you choose and gives you the measures that go with each.
$md$)
where slug = 'plakja-e-shendetshme' and description->>'sq' like '[CONTENT: replace]%';
