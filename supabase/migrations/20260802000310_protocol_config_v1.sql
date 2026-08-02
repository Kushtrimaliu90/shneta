-- =============================================================================
-- 22 · BioHack Protocol config v1 (docs/15 §5)
-- =============================================================================

/*
 * A migration rather than a seed file, deliberately: the `supabase/seeds` directory is
 * local-and-staging only and is applied by `db reset`, while the linked project only ever
 * receives migrations.
 * This is not demo data — without an approved version the generator returns nothing at all, so it
 * has to exist wherever the feature is enabled. Re-runnable by design: fixed config id,
 * `on conflict do update`, blocks deleted and reinserted, so editing this file edits v1.
 *
 * An approved ruleset covering all sixteen goals, so the generator works the first time somebody
 * opens it rather than returning "nothing matched" until an editor fills a matrix in.
 *
 * Written as a `values` list joined on **slug**, not as fifty explicit inserts with UUIDs. The
 * ids differ per environment and the slugs do not, so this file stays readable, re-runnable, and
 * diffable when a weight changes.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Claim language
 *
 * Every `why` is written inside the permitted-function wording of docs/08 §7.2: "kontribuon në",
 * "mbështet", "ndihmon". Nothing here says cures, treats, prevents or heals, and nothing names a
 * disease. This copy is shown to customers as the reason a product is in their protocol, which
 * makes it a health claim in the regulatory sense — it goes through compliance like any other.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * One honest gap
 *
 * docs/15 §5 asks for a caffeine + L-theanine pairing under `truri`, and a caffeine × sleep
 * timing rule. **The seeded catalogue contains neither** — there is no caffeinated product and no
 * L-theanine. The flags, the question and the caffeine handling in the engine all exist and are
 * unit tested; they simply filter nothing until such a product is stocked. Inventing an ingredient
 * row with no product behind it would make the generator recommend something unbuyable, which is
 * worse than the gap.
 */

-- -----------------------------------------------------------------------------
-- Ingredient flags the engine filters on
-- -----------------------------------------------------------------------------

/*
 * Conservative by design. `med_sensitive` costs a recommendation when it fires; not setting it
 * costs an interaction. Ashwagandha (thyroid, sedatives, immunosuppressants), melatonin
 * (sedatives, anticoagulants) and curcumin (anticoagulants) are the three in this catalogue with
 * well-documented prescription interactions.
 */
update ingredients set med_sensitive = true
  where slug in ('ashwagandha', 'melatonin', 'curcumin');

-- -----------------------------------------------------------------------------
-- What to measure, per goal (docs/15 §1 step 3 — the "Çfarë të masësh" card)
-- -----------------------------------------------------------------------------

update health_goals set metrics_i18n = m.metrics from (values
  ('energji', '{"sq":["Energjia gjatë ditës (1–10)","Rënia e pasdites (po/jo)"],"en":["Daytime energy (1–10)","Afternoon slump (yes/no)"]}'::jsonb),
  ('gjumi', '{"sq":["Cilësia e gjumit (1–10)","Minuta për të fjetur","Zgjimet gjatë natës"],"en":["Sleep quality (1–10)","Minutes to fall asleep","Night wakings"]}'::jsonb),
  ('imuniteti', '{"sq":["Ditë me simptoma në muaj","Energjia (1–10)"],"en":["Symptom days per month","Energy (1–10)"]}'::jsonb),
  ('stresi', '{"sq":["Niveli i stresit (1–10)","Cilësia e gjumit (1–10)"],"en":["Stress level (1–10)","Sleep quality (1–10)"]}'::jsonb),
  ('truri', '{"sq":["Përqendrimi (1–10)","Minuta punë e fokusuar"],"en":["Focus (1–10)","Minutes of deep work"]}'::jsonb),
  ('zemra', '{"sq":["Pulsi në qetësi","Minuta aktivitet në javë"],"en":["Resting heart rate","Active minutes per week"]}'::jsonb),
  ('kockat', '{"sq":["Minuta ngarkesë në javë","Vitamina D (nëse matet)"],"en":["Weight-bearing minutes per week","Vitamin D (if measured)"]}'::jsonb),
  ('nyjet', '{"sq":["Rehatia në lëvizje (1–10)","Ngurtësia në mëngjes"],"en":["Movement comfort (1–10)","Morning stiffness"]}'::jsonb),
  ('shendeti-i-gruas', '{"sq":["Energjia (1–10)","Rregullsia e ciklit"],"en":["Energy (1–10)","Cycle regularity"]}'::jsonb),
  ('shendeti-i-burrit', '{"sq":["Energjia (1–10)","Rikuperimi pas stërvitjes"],"en":["Energy (1–10)","Recovery after training"]}'::jsonb),
  ('tretja', '{"sq":["Rehatia e tretjes (1–10)","Rregullsia"],"en":["Digestive comfort (1–10)","Regularity"]}'::jsonb),
  ('pesha', '{"sq":["Pesha (javore)","Uria mes vakteve (1–10)"],"en":["Weight (weekly)","Hunger between meals (1–10)"]}'::jsonb),
  ('floket', '{"sq":["Rënia e flokëve (1–10)","Shndritja"],"en":["Hair shedding (1–10)","Shine"]}'::jsonb),
  ('lekura', '{"sq":["Hidratimi i lëkurës (1–10)","Ndjeshmëria"],"en":["Skin hydration (1–10)","Sensitivity"]}'::jsonb),
  ('thonjte', '{"sq":["Forca e thonjve (1–10)","Thyerjet në muaj"],"en":["Nail strength (1–10)","Breaks per month"]}'::jsonb),
  ('plakja-e-shendetshme', '{"sq":["Energjia (1–10)","Rikuperimi","Lëvizshmëria"],"en":["Energy (1–10)","Recovery","Mobility"]}'::jsonb)
) as m(slug, metrics) where health_goals.slug = m.slug;

-- -----------------------------------------------------------------------------
-- The config version
-- -----------------------------------------------------------------------------

/*
 * NOTE for anyone editing these comments: Postgres block comments NEST, so a `/`+`*` sequence
 * inside one opens a nested comment and everything after it becomes comment. See docs/13 §S3.
 *
 * Fixed id so re-running this file updates v1 rather than stacking versions. Approved outright:
 * this copy is written to docs/08 §7.2 and is the baseline compliance will diff future drafts
 * against.
 */
insert into protocol_configs (id, status, notes, approved_at)
values (
  'c0000000-0000-4000-8000-000000000001',
  'approved',
  'Seed v1 — all 16 goals, EFSA-safe copy (docs/15 §5).',
  now()
)
on conflict (id) do update set status = excluded.status, notes = excluded.notes;

delete from protocol_blocks where config_id = 'c0000000-0000-4000-8000-000000000001';
delete from protocol_conflicts where config_id = 'c0000000-0000-4000-8000-000000000001';

-- -----------------------------------------------------------------------------
-- Blocks
-- -----------------------------------------------------------------------------

insert into protocol_blocks (
  config_id, goal_id, ingredient_id, habit_i18n, weight, is_core, timing, phase, why_i18n, caution_i18n
)
select
  'c0000000-0000-4000-8000-000000000001',
  g.id,
  i.id,
  case when b.habit_sq is null then null
       else jsonb_build_object('sq', b.habit_sq, 'en', b.habit_en) end,
  b.weight,
  b.is_core,
  b.timing::timing_slot[],
  b.phase,
  jsonb_build_object('sq', b.why_sq, 'en', b.why_en),
  case when b.caution_sq is null then null
       else jsonb_build_object('sq', b.caution_sq, 'en', b.caution_en) end
from (values
  -- goal, ingredient, habit sq, habit en, weight, core, timing, phase, why sq, why en, caution sq, caution en
  ('energji','vitamin-b12',null,null,90,true,'{mengjes}',1,'Vitamina B12 kontribuon në metabolizmin normal të energjisë.','Vitamin B12 contributes to normal energy metabolism.',null,null),
  ('energji','vitamin-d3',null,null,75,false,'{mengjes,me_ushqim}',1,'Vitamina D merret më mirë me një vakt që përmban yndyrë.','Vitamin D absorbs better with a meal containing fat.',null,null),
  ('energji',null,'Dritë dielli 10 minuta para orës 10:00','10 minutes of daylight before 10am',80,true,'{mengjes}',1,'Drita e mëngjesit ndihmon në rregullimin e ritmit ditor.','Morning light helps set your daily rhythm.',null,null),
  ('energji','b-complex',null,null,60,false,'{mengjes}',2,'Grupi B mbështet metabolizmin normal të energjisë.','The B group supports normal energy metabolism.',null,null),

  ('gjumi','magnesium',null,null,90,true,'{mbremje,para_gjumit}',1,'Magnezi kontribuon në funksionimin normal të sistemit nervor.','Magnesium contributes to normal nervous-system function.',null,null),
  ('gjumi','melatonin',null,null,70,false,'{para_gjumit}',2,'Melatonina ndihmon në zvogëlimin e kohës për të fjetur.','Melatonin helps reduce the time it takes to fall asleep.','Merre vetëm para gjumit dhe jo para se të drejtosh automjet.','Take only before bed, never before driving.'),
  ('gjumi',null,'Pa ekrane 60 minuta para gjumit','No screens 60 minutes before bed',80,true,'{mbremje}',1,'Drita e ekranit në mbrëmje ndikon në ritmin e gjumit.','Evening screen light affects your sleep rhythm.',null,null),

  ('imuniteti','vitamin-c',null,null,90,true,'{mengjes}',1,'Vitamina C kontribuon në funksionimin normal të sistemit imunitar.','Vitamin C contributes to normal immune-system function.',null,null),
  ('imuniteti','vitamin-d3',null,null,85,false,'{mengjes,me_ushqim}',1,'Vitamina D kontribuon në funksionimin normal të sistemit imunitar.','Vitamin D contributes to normal immune-system function.',null,null),
  ('imuniteti','zinc',null,null,70,false,'{me_ushqim}',1,'Zinku kontribuon në funksionimin normal të sistemit imunitar.','Zinc contributes to normal immune-system function.','Mos e merr esëll — merre me ushqim.','Do not take on an empty stomach — take it with food.'),

  ('stresi','ashwagandha',null,null,90,true,'{mbremje}',1,'Ashwagandha përdoret tradicionalisht për periudha të ngarkuara.','Ashwagandha is traditionally used during demanding periods.','Jo gjatë shtatzënisë ose gjidhënies.','Not during pregnancy or breastfeeding.'),
  ('stresi','magnesium',null,null,75,false,'{mbremje}',1,'Magnezi kontribuon në funksionimin normal psikologjik.','Magnesium contributes to normal psychological function.',null,null),
  ('stresi',null,'Pesë minuta frymëmarrje e ngadaltë','Five minutes of slow breathing',70,true,'{mbremje}',1,'Një rutinë e shkurtër mbrëmjeje ndihmon në qetësimin para gjumit.','A short evening routine helps you wind down.',null,null),
  ('stresi','rhodiola',null,null,60,false,'{mengjes}',2,'Rhodiola përdoret tradicionalisht gjatë periudhave të lodhjes.','Rhodiola is traditionally used during tiring periods.',null,null),

  ('truri','omega-3',null,null,90,true,'{me_ushqim}',1,'DHA kontribuon në funksionimin normal të trurit.','DHA contributes to normal brain function.',null,null),
  ('truri','creatine',null,null,80,false,'{dite}',2,'Kreatina mbështet furnizimin me energji të qelizave.','Creatine supports cellular energy supply.',null,null),
  ('truri','b-complex',null,null,65,false,'{mengjes}',1,'Vitaminat B kontribuojnë në funksionimin normal psikologjik.','B vitamins contribute to normal psychological function.',null,null),

  ('zemra','omega-3',null,null,90,true,'{me_ushqim}',1,'EPA dhe DHA kontribuojnë në funksionimin normal të zemrës.','EPA and DHA contribute to normal heart function.',null,null),
  ('zemra','magnesium',null,null,70,false,'{mbremje}',1,'Magnezi kontribuon në funksionimin normal të muskujve.','Magnesium contributes to normal muscle function.',null,null),
  ('zemra',null,'30 minuta ecje e shpejtë','30 minutes of brisk walking',75,true,'{dite}',1,'Lëvizja e rregullt është baza e çdo rutine.','Regular movement is the base of any routine.',null,null),

  ('kockat','vitamin-d3',null,null,90,true,'{mengjes,me_ushqim}',1,'Vitamina D kontribuon në ruajtjen e kockave normale.','Vitamin D contributes to the maintenance of normal bones.',null,null),
  ('kockat','magnesium',null,null,75,false,'{mbremje}',1,'Magnezi kontribuon në ruajtjen e kockave normale.','Magnesium contributes to the maintenance of normal bones.',null,null),
  ('kockat',null,'Dy seanca me ngarkesë në javë','Two weight-bearing sessions a week',70,true,'{dite}',2,'Ngarkesa mekanike është stimuli kryesor për kockat.','Mechanical loading is the main stimulus for bone.',null,null),

  ('nyjet','curcumin',null,null,85,true,'{me_ushqim}',1,'Kurkumina merret më mirë së bashku me një vakt.','Curcumin is absorbed better alongside a meal.',null,null),
  ('nyjet','omega-3',null,null,80,false,'{me_ushqim}',1,'Omega-3 është pjesë e një rutine për lëvizshmëri.','Omega-3 is part of a mobility routine.',null,null),
  ('nyjet','collagen',null,null,70,false,'{mengjes}',2,'Kolagjeni është proteina kryesore e indit lidhor.','Collagen is the main protein of connective tissue.',null,null),

  ('shendeti-i-gruas','iron',null,null,85,true,'{mengjes}',1,'Hekuri kontribuon në zvogëlimin e lodhjes.','Iron contributes to the reduction of tiredness.','Merre larg çajit dhe kafesë.','Take away from tea and coffee.'),
  ('shendeti-i-gruas','vitamin-d3',null,null,75,false,'{mengjes,me_ushqim}',1,'Vitamina D mbështet shëndetin e kockave dhe imunitetin.','Vitamin D supports bone health and immunity.',null,null),
  ('shendeti-i-gruas','magnesium',null,null,70,false,'{mbremje}',1,'Magnezi kontribuon në funksionimin normal të muskujve.','Magnesium contributes to normal muscle function.',null,null),

  ('shendeti-i-burrit','zinc',null,null,85,true,'{me_ushqim}',1,'Zinku kontribuon në ruajtjen e niveleve normale të testosteronit.','Zinc contributes to the maintenance of normal testosterone levels.','Mos e merr esëll.','Do not take on an empty stomach.'),
  ('shendeti-i-burrit','creatine',null,null,80,false,'{dite,para_stervitjes}',1,'Kreatina rrit performancën në stërvitje të shkurtra intensive.','Creatine increases performance in short intense exercise.',null,null),
  ('shendeti-i-burrit','vitamin-d3',null,null,70,false,'{mengjes,me_ushqim}',1,'Vitamina D mbështet funksionin normal të muskujve.','Vitamin D supports normal muscle function.',null,null),

  ('tretja','probiotic',null,null,90,true,'{mengjes}',1,'Probiotikët janë pjesë e një rutine për tretjen.','Probiotics are part of a digestive routine.',null,null),
  ('tretja','psyllium',null,null,75,false,'{mbremje}',1,'Fibra kontribuon në funksionimin normal të zorrëve.','Fibre contributes to normal bowel function.','Merre me shumë ujë.','Take with plenty of water.'),
  ('tretja',null,'Një vakt me perime në ditë','One vegetable-rich meal a day',70,true,'{dite}',1,'Fibra nga ushqimi është baza — suplementi e plotëson.','Food fibre is the base — a supplement tops it up.',null,null),

  ('pesha','plant-protein',null,null,85,true,'{mengjes}',1,'Proteina kontribuon në ruajtjen e masës muskulore.','Protein contributes to the maintenance of muscle mass.',null,null),
  ('pesha','psyllium',null,null,70,false,'{dite}',2,'Fibra ndihmon në ndjesinë e ngopjes gjatë vakteve.','Fibre helps with fullness at meals.','Merre me shumë ujë.','Take with plenty of water.'),
  ('pesha',null,'Proteinë në çdo vakt','Protein at every meal',80,true,'{dite}',1,'Proteina e shpërndarë gjatë ditës mbështet ngopjen.','Protein spread through the day supports fullness.',null,null),

  ('floket','collagen',null,null,85,true,'{mengjes}',1,'Kolagjeni është proteina kryesore e indit lidhor.','Collagen is the main protein of connective tissue.',null,null),
  ('floket','zinc',null,null,80,false,'{me_ushqim}',1,'Zinku kontribuon në ruajtjen e flokëve normalë.','Zinc contributes to the maintenance of normal hair.','Mos e merr esëll.','Do not take on an empty stomach.'),
  ('floket','b-complex',null,null,70,false,'{mengjes}',2,'Biotina kontribuon në ruajtjen e flokëve normalë.','Biotin contributes to the maintenance of normal hair.',null,null),

  ('lekura','collagen',null,null,90,true,'{mengjes}',1,'Kolagjeni është proteina kryesore e lëkurës.','Collagen is the main protein of skin.',null,null),
  ('lekura','hyaluronic-acid',null,null,80,false,'{mengjes}',1,'Acidi hialuronik mban ujin në ind.','Hyaluronic acid holds water in tissue.',null,null),
  ('lekura','vitamin-c',null,null,75,false,'{mengjes}',1,'Vitamina C kontribuon në formimin normal të kolagjenit.','Vitamin C contributes to normal collagen formation.',null,null),

  ('thonjte','collagen',null,null,85,true,'{mengjes}',1,'Kolagjeni është proteina kryesore e indit lidhor.','Collagen is the main protein of connective tissue.',null,null),
  ('thonjte','b-complex',null,null,80,false,'{mengjes}',1,'Biotina kontribuon në ruajtjen e thonjve normalë.','Biotin contributes to the maintenance of normal nails.',null,null),
  ('thonjte','zinc',null,null,70,false,'{me_ushqim}',2,'Zinku kontribuon në ruajtjen e thonjve normalë.','Zinc contributes to the maintenance of normal nails.','Mos e merr esëll.','Do not take on an empty stomach.'),

  ('plakja-e-shendetshme','omega-3',null,null,85,true,'{me_ushqim}',1,'EPA dhe DHA janë pjesë e një rutine afatgjatë.','EPA and DHA are part of a long-term routine.',null,null),
  ('plakja-e-shendetshme','vitamin-d3',null,null,80,false,'{mengjes,me_ushqim}',1,'Vitamina D mbështet kockat, muskujt dhe imunitetin.','Vitamin D supports bones, muscle and immunity.',null,null),
  ('plakja-e-shendetshme','creatine',null,null,75,false,'{dite}',2,'Kreatina mbështet ruajtjen e forcës me kalimin e viteve.','Creatine supports maintaining strength over the years.',null,null),
  ('plakja-e-shendetshme',null,'Dy seanca force në javë','Two strength sessions a week',80,true,'{dite}',1,'Forca është parashikuesi më i mirë i pavarësisë me moshë.','Strength is the best predictor of independence with age.',null,null)
) as b(goal_slug, ingredient_slug, habit_sq, habit_en, weight, is_core, timing, phase, why_sq, why_en, caution_sq, caution_en)
join health_goals g on g.slug = b.goal_slug
left join ingredients i on i.slug = b.ingredient_slug
/*
 * Skip a row whose ingredient is not stocked in this environment.
 *
 * Without this the left join yields `ingredient_id = null` with no habit either, which violates
 * `protocol_block_is_ingredient_or_habit` and fails the whole migration. Not hypothetical:
 * `iron` sits in the ingredient table on no product, and a real catalogue will not match these
 * slugs exactly. A missing ingredient should cost one block, never the config.
 */
where b.ingredient_slug is null or i.id is not null;

-- -----------------------------------------------------------------------------
-- Conflicts
-- -----------------------------------------------------------------------------

/*
 * Melatonin is confined to the evening rather than excluded: it is genuinely useful for sleep and
 * genuinely wrong at 8am, and a `timing_rule` says that where an `exclude` would throw away a
 * good recommendation. The rule fires whenever it lands in a protocol at all, which is why its
 * other side is the sleep goal it comes from.
 */
insert into protocol_conflicts (config_id, a_ingredient, b_goal, kind, rule, note_i18n)
select
  'c0000000-0000-4000-8000-000000000001',
  i.id,
  g.id,
  'timing_rule',
  '{"allowed_slots": ["para_gjumit"]}'::jsonb,
  jsonb_build_object('sq', 'Vetëm para gjumit.', 'en', 'Before bed only.')
from ingredients i, health_goals g
where i.slug = 'melatonin' and g.slug = 'gjumi';

/*
 * Iron and zinc compete for the same absorption pathway, so taking them together gets you less of
 * both. A caution rather than an exclusion: both are legitimate in a shendeti-i-gruas protocol,
 * and the fix is scheduling, not removal.
 */
insert into protocol_conflicts (config_id, a_ingredient, b_ingredient, kind, rule, note_i18n)
select
  'c0000000-0000-4000-8000-000000000001',
  a.id,
  b.id,
  'caution',
  '{"separate_slots": true}'::jsonb,
  jsonb_build_object(
    'sq', 'Merre në orë të ndryshme nga zinku — konkurrojnë për thithje.',
    'en', 'Take at a different time from zinc — they compete for absorption.'
  )
from ingredients a, ingredients b
where a.slug = 'iron' and b.slug = 'zinc';
