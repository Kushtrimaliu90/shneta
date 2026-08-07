-- =============================================================================
-- 69 · Synonym groups and query redirects
-- Source: the search audit, items 5 and 9.
-- =============================================================================

/*
 * ── Why this is a migration and not a seed ──
 *
 * Seeds are demo content and a production database may never see them. This is *configuration*: without
 * it, "kolagjen" does not find the collagen peptides and "gjumë" does not find the sleep range. The shop
 * is wrong without these rows, so they ship with the schema.
 *
 * ── How the list was built ──
 *
 * Read off the actual catalogue — the 38 ingredients, the 16 health goals, the product forms — rather than
 * invented. Each group covers a gap that survives the widened document in migration 65:
 *
 *   · **Albanian morphology.** There is no Albanian stemmer in Postgres and `simple` does no stemming at
 *     all, so the definite form is a different word from the indefinite: `magnezi` ≠ `magnez`,
 *     `zinku` ≠ `zink`, `kolagjenit` ≠ `kolagjen`. The ingredient is stored in one form and shoppers type
 *     the other. This is the single biggest recall gap in the catalogue and most of the list addresses it.
 *   · **Cross-language pairs the data does not already carry.** `other_names` covers a lot — "Acid
 *     askorbik", "Vaj peshku", "Kolekalciferol" are all in there and are indexed as of migration 65 — so
 *     those are deliberately *not* repeated here. What is missing is the everyday word: "hirrë" for whey,
 *     "kolagjen" where only "Peptidet e kolagjenit" is stored.
 *   · **Concepts, not ingredients.** Nobody searches "melatonin" when they cannot sleep; they search
 *     "gjumë", "pagjumësi", "insomnia".
 *
 * ── The one trap ──
 *
 * A group fires when a document contains **any** of its terms, and then adds **all** of them. So a term
 * that appears in an unrelated product poisons the group. Units are the obvious hazard: `mg` looks like a
 * fine synonym for magnesium until you notice that "Vitamin C 500 mg" tokenises to a bare `mg`, fires the
 * magnesium group, and makes vitamin C a result for "magnez". No units, no bare letters — every term here
 * is specific enough that its presence really does mean the concept is present.
 *
 * Accents are irrelevant on both sides: terms and documents are normalised through `search_normalize`
 * before they meet, so "gjumë" and "gjume" are the same term and only one of them needs listing.
 */

insert into search_synonym_groups (label, terms, note) values

-- ── Minerals: the definite/indefinite split ────────────────────────────────────
('Magnesium',   '{magnez,magnezi,magneziumi,magnesium,magnezium}',            'Albanian definite form differs from the stored ingredient name.'),
('Zinc',        '{zink,zinku,zinc}',                                          null),
('Iron',        '{hekur,hekuri,iron,ferrum}',                                 null),
('Calcium',     '{kalcium,kalciumi,calcium,kalciumit}',                       null),
('Selenium',    '{selen,seleni,selenium,selenit}',                            null),
('Potassium',   '{kalium,kaliumi,potassium}',                                 null),
('Electrolytes','{elektrolite,elektrolitesh,elektrolit,electrolytes,electrolyte}', null),

-- ── Vitamins ──────────────────────────────────────────────────────────────────
('Vitamins (generic)', '{vitamine,vitamina,vitaminat,vitamin,vitamins,vitaminave}', 'The bare noun, in every form a shopper types it.'),
('Vitamin C',   '{"vitamina c","vitamin c",askorbik,ascorbic}',               null),
('Vitamin D',   '{"vitamina d","vitamin d","vitamina d3","vitamin d3",d3,kolekalciferol,cholecalciferol}', null),
('Vitamin K2',  '{"vitamina k2","vitamin k2",k2,"mk 7",menaquinone}',         null),
('Vitamin B12', '{"vitamina b12","vitamin b12",b12,kobalamin,cobalamin}',     null),
('B complex',   '{"kompleksi b","b complex","b kompleks","vitamina b","vitamin b"}', null),
('Multivitamin','{multivitamine,multivitamina,multivitamin,multivitamins,multi}', null),
('Minerals',    '{mineral,minerale,mineralet,minerals}',                      null),

-- ── Proteins and sports ───────────────────────────────────────────────────────
('Protein',     '{proteine,proteina,proteinat,protein,proteins,proteinave}',  null),
('Whey',        '{hirre,hirra,whey,"proteina whey","whey protein"}',          'Hirrë is the everyday Albanian word and appears nowhere in the data.'),
('Creatine',    '{kreatine,kreatina,kreatin,creatine,monohidrat,monohydrate}', null),
('Collagen',    '{kolagjen,kolagjeni,kolagjenit,kolagen,collagen}',           'Stored only as "Peptidet e kolagjenit".'),
('Amino acids', '{aminoacide,aminoacid,"amino acids","amino acid",bcaa,eaa}', null),
('Pre-workout', '{"para stervitjes","pre workout",preworkout,"para trajnimit"}', null),

-- ── Fats and fibre ────────────────────────────────────────────────────────────
('Omega 3',     '{omega,"omega 3","fish oil","vaj peshku",epa,dha}',          null),
('Fibre',       '{fiber,fibra,fibre,fibrat,psyllium}',                        null),
('Probiotics',  '{probiotik,probiotike,probiotiket,probiotic,probiotics,"bakterie te mira"}', null),
('Turmeric',    '{shafran,kurkuma,kurkumine,kurkumina,turmeric,curcumin}',    null),

-- ── Concepts: what people search instead of an ingredient ─────────────────────
('Sleep',       '{gjume,gjumi,gjumit,pagjumesi,insomnia,sleep,"nuk fle",relaksim}', null),
('Energy',      '{energji,energjia,lodhje,lodhja,fatigue,energy,tiredness,"pa energji"}', null),
('Immunity',    '{imunitet,imuniteti,imunitar,immunity,immune,ftohje,grip}',  null),
('Stress',      '{stres,stresi,ankth,ankthi,qetesi,stress,anxiety,calm}',     null),
('Focus',       '{fokus,fokusi,koncentrim,perqendrim,memorje,kujtese,tru,truri,focus,memory,brain,concentration}', null),
('Digestion',   '{tretje,tretja,stomak,stomaku,bark,digestion,digestive,gut,fryrje}', null),
('Joints',      '{nyje,nyjet,kyce,artikulacione,joints,joint,mobility}',      null),
('Bones',       '{kocka,kockat,eshtra,bones,bone,osteo}',                     null),
('Heart',       '{zemra,zemer,kolesterol,kardio,heart,cardio,cardiovascular,cholesterol}', null),
('Skin',        '{lekura,lekure,skin,dermal,akne}',                           null),
('Hair & nails','{floket,flok,thonjte,thonj,hair,nails,nail}',                null),
('Weight',      '{pesha,peshe,dobesim,humbje,metabolizem,weight,slimming,metabolism,"humbje peshe"}', null),
('Muscle',      '{muskuj,muskujt,muskulor,masa,muscle,muscles,"masa muskulore"}', null),
('Performance', '{performance,performanca,stervitje,trajnim,palester,gym,sport,sportist,endurance}', null),
('Women',       '{grua,gruas,femra,femer,women,woman,menopauze,menopause}',   null),
('Men',         '{burr,burri,burrit,mashkull,men,man,prostate,prostata}',     null),
('Healthy ageing', '{plakje,plakja,antiage,"anti age",ageing,aging,longjevitet,longevity}', null),

-- ── Forms ─────────────────────────────────────────────────────────────────────
('Capsules',    '{kapsula,kapsule,kapsulat,capsule,capsules,caps}',           null),
('Tablets',     '{tableta,tablete,tabletat,tablet,tablets}',                  null),
('Powder',      '{pluhur,pluhurit,powder,pudra}',                             null),
('Softgels',    '{softgel,softgels,"kapsula te buta",xhel,gel}',              null),
('Gummies',     '{gomeza,gomezat,gummies,gummy,karamele}',                    null),
('Liquid',      '{lengje,leng,pika,drops,liquid,shurup}',                     null),

-- ── Umbrella ──────────────────────────────────────────────────────────────────
('Supplements', '{suplement,suplemente,suplementet,supplement,supplements,shtese,shtesa}', null),
('Vegan',       '{vegan,vegane,vegetarian,vegjetarian,bimore,"plant based"}', null);

-- -----------------------------------------------------------------------------
-- Query redirects
-- -----------------------------------------------------------------------------

/*
 * Searches that want a page, not a product list.
 *
 * Every one of these returns zero products today, which reads to a shopper as "we do not do that" rather
 * than "that is on the shipping page". `contains` rather than `exact` for most of them: "sa kushton
 * transporti" and "transporti" both mean the same question.
 *
 * Destinations are unlocalised — the caller prefixes `/en` when it needs to — so one row serves both
 * locales and neither can be forgotten.
 */
insert into search_redirects (query, match_type, destination_path, note) values
  ('transport',      'contains', '/legal/shipping-returns', 'Shipping questions.'),
  ('dergesa',        'contains', '/legal/shipping-returns', null),
  ('dergese',        'contains', '/legal/shipping-returns', null),
  ('shipping',       'contains', '/legal/shipping-returns', null),
  ('delivery',       'contains', '/legal/shipping-returns', null),
  ('kthim',          'contains', '/legal/shipping-returns', 'Returns.'),
  ('rimbursim',      'contains', '/legal/shipping-returns', null),
  ('returns',        'contains', '/legal/shipping-returns', null),
  ('refund',         'contains', '/legal/shipping-returns', null),
  ('kontakt',        'contains', '/contact',                null),
  ('contact',        'contains', '/contact',                null),
  ('pyetje',         'contains', '/faq',                    null),
  ('faq',            'contains', '/faq',                    null),
  ('porosia ime',    'contains', '/order-lookup',           'Order tracking.'),
  ('gjurmo',         'contains', '/order-lookup',           null),
  ('track order',    'contains', '/order-lookup',           null),
  ('my order',       'contains', '/order-lookup',           null),
  ('abonim',         'contains', '/subscriptions',          null),
  ('subscription',   'contains', '/subscriptions',          null),
  ('privatesi',      'contains', '/legal/privacy',          null),
  ('privacy',        'contains', '/legal/privacy',          null),
  ('kushtet',        'contains', '/legal/terms',            null),
  ('terms',          'contains', '/legal/terms',            null),
  ('referim',        'contains', '/legal/referral-terms',   null),
  ('referral',       'contains', '/legal/referral-terms',   null),
  ('rreth nesh',     'contains', '/about',                  null),
  ('about us',       'contains', '/about',                  null);

/*
 * The synonym insert above fires the statement trigger from migration 65, which re-indexes the whole
 * catalogue. Called again explicitly because migration order is not seed order: on a fresh
 * `supabase db reset` there are no products yet when the trigger fires, and the products that arrive
 * later index themselves correctly through their own trigger. On an *existing* database — production —
 * the products are already there and this is the call that rewrites them.
 */
select public.reindex_products_search();
