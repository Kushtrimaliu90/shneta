-- =============================================================================
-- 24 · The first personalisation rule set, attached to approved config v1
-- Source: docs/15 §9.
-- =============================================================================

/*
 * Eighteen rules. Each one is a claim about nutrition that a product manager can read, disagree
 * with, and change in `/admin/biohack` without a deploy — which is the entire reason this is a
 * table and not a function.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What is and is not asserted here
 *
 * Every rule below reflects a well-established nutritional relationship: B12 absorption declining
 * with age, menstrual iron losses, bone mineral density after menopause, protein and creatine
 * intake tracking body mass, sweat losses at high training volume. These are the relationships
 * EFSA-authorised claims are built on, and the copy is written in that register — what a nutrient
 * *contributes to*, never what it fixes.
 *
 * What is deliberately absent is anything that would require knowing more about a person than five
 * bands can tell us. There is no rule keyed on weight-and-height together, because that is BMI in
 * disguise and a supplement shop has no business assigning someone a BMI category. Height is
 * collected, is available as a condition, and no seeded rule uses it — stated plainly rather than
 * quietly, so the next person does not assume it was an oversight.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A migration rather than a seed file
 *
 * Same reasoning as migration 22, which seeded the config itself: the linked project receives
 * migrations only, and without rules this feature is inert. The rules belong to config v1, which
 * is already approved — adding them to an approved version is a deliberate exception made once,
 * while there are no customers, and noted in docs/15 §9. From here on, changing a rule means a
 * draft and an approval like everything else.
 *
 * The `where` guard on the insert makes it idempotent and keeps a missing ingredient from failing
 * the whole file, which is the trap migration 22 fell into (docs/13 §T2).
 */

with target as (
  select id from protocol_configs where status = 'approved' order by version desc limit 1
),
seeded (ingredient_slug, sort_order, when_profile, effect, reason_sq, reason_en, caution_sq, caution_en) as (
  values
    -- ── Age ──────────────────────────────────────────────────────────────────
    /*
     * B12 absorption falls with age: atrophic gastritis and lower stomach acid reduce how much is
     * taken up from food, which is why intake matters more later even when diet has not changed.
     */
    ('vitamin-b12', 10,
     '{"age_bands":["50_64","65_plus"]}'::jsonb,
     '{"weight_delta":20}'::jsonb,
     'Pas moshës 50, thithja e B12 nga ushqimi bie natyrshëm — prandaj e peshojmë më shumë.',
     'After 50, B12 absorption from food falls naturally — so we weight it higher.',
     null, null),

    /*
     * Vitamin D and calcium for bone maintenance, and protein against the muscle-mass decline that
     * begins in middle age. Both are the standard nutritional levers for this band.
     */
    ('vitamin-d3', 11,
     '{"age_bands":["50_64","65_plus"]}'::jsonb,
     '{"weight_delta":15}'::jsonb,
     'Vitamina D kontribuon në ruajtjen e kockave normale, dhe kjo merr më shumë peshë me moshën.',
     'Vitamin D contributes to the maintenance of normal bones, which carries more weight with age.',
     null, null),

    /*
     * A standing caution for the oldest band, attached to every candidate rather than one
     * ingredient — the one legitimate use of a null `ingredient_id`. Polypharmacy is common in this
     * group and the interaction surface is wide enough that the honest thing is to say so once.
     */
    (null, 12,
     '{"age_bands":["65_plus"]}'::jsonb,
     '{"weight_delta":1}'::jsonb,
     'Në këtë moshë ndërveprimet me medikamente janë më të shpeshta.',
     'Interactions with medication are more common at this age.',
     'Trego listën e suplementeve te mjeku ose farmacisti para se të nisësh.',
     'Show the list to your doctor or pharmacist before starting.'),

    -- ── Sex ──────────────────────────────────────────────────────────────────
    /*
     * Iron for menstruating women — the single most common shortfall in this group. Bounded to the
     * bands where menstruation is likely rather than applied to every woman, because iron is not
     * something to nudge upward for a post-menopausal customer without a reason.
     *
     * `iron` has no product behind it in this catalogue, so the engine will mark it "së shpejti".
     * That is the correct outcome and better than silence: the customer learns it is relevant.
     */
    ('iron', 20,
     '{"sexes":["femer"],"age_bands":["18_29","30_39","40_49"]}'::jsonb,
     '{"weight_delta":25}'::jsonb,
     'Humbjet mujore e bëjnë hekurin një temë të shpeshtë për gratë në këtë moshë.',
     'Monthly losses make iron a frequent topic for women in this age range.',
     'Merre me vitaminë C dhe jo bashkë me kafe ose çaj.',
     'Take it with vitamin C, and not alongside coffee or tea.'),

    /*
     * Bone density falls faster after menopause. Vitamin D and calcium are the pair with
     * authorised bone-maintenance claims; this catalogue stocks the D.
     */
    ('vitamin-d3', 21,
     '{"sexes":["femer"],"age_bands":["50_64","65_plus"]}'::jsonb,
     '{"weight_delta":20}'::jsonb,
     'Pas menopauzës, ruajtja e kockave merr më shumë peshë.',
     'After menopause, maintaining bone becomes more important.',
     null, null),

    /*
     * Zinc contributes to the maintenance of normal testosterone levels in the blood — an
     * authorised claim, and the reason zinc appears in nearly every men's formula.
     */
    ('zinc', 22,
     '{"sexes":["mashkull"],"age_bands":["30_39","40_49","50_64","65_plus"]}'::jsonb,
     '{"weight_delta":15}'::jsonb,
     'Zinku kontribuon në ruajtjen e niveleve normale të testosteronit në gjak.',
     'Zinc contributes to the maintenance of normal testosterone levels in the blood.',
     null, null),

    -- ── Activity ─────────────────────────────────────────────────────────────
    /*
     * Protein and creatine are the two ingredients whose sensible intake tracks body mass, and
     * they are also the two the activity bands should move most. `servings_hint` asks the result
     * page for a "at your weight, N label servings" note — a multiplier on the manufacturer's
     * serving, never a dose we invented.
     */
    ('whey-protein', 30,
     '{"activity":["i_rregullt","intensiv"]}'::jsonb,
     '{"weight_delta":25,"servings_hint":true}'::jsonb,
     'Proteina kontribuon në rritjen dhe ruajtjen e masës muskulore — më e rëndësishme kur stërviteni rregullisht.',
     'Protein contributes to the growth and maintenance of muscle mass — more relevant when you train regularly.',
     null, null),

    ('plant-protein', 31,
     '{"activity":["i_rregullt","intensiv"]}'::jsonb,
     '{"weight_delta":25,"servings_hint":true}'::jsonb,
     'Proteina kontribuon në rritjen dhe ruajtjen e masës muskulore — më e rëndësishme kur stërviteni rregullisht.',
     'Protein contributes to the growth and maintenance of muscle mass — more relevant when you train regularly.',
     null, null),

    ('creatine', 32,
     '{"activity":["intensiv"]}'::jsonb,
     '{"weight_delta":25,"servings_hint":true}'::jsonb,
     'Kreatina rrit performancën fizike në seri të shkurtra me intensitet të lartë.',
     'Creatine increases physical performance in short bursts of high-intensity exercise.',
     null, null),

    /*
     * Sweat losses at high volume: sodium, potassium and magnesium. Magnesium contributes to normal
     * muscle function and to electrolyte balance, both authorised.
     */
    ('electrolytes', 33,
     '{"activity":["intensiv"]}'::jsonb,
     '{"weight_delta":20}'::jsonb,
     'Në volum të lartë stërvitjeje, humbjet me djersë janë reale.',
     'At high training volume, sweat losses are real.',
     null, null),

    ('magnesium', 34,
     '{"activity":["i_rregullt","intensiv"]}'::jsonb,
     '{"weight_delta":15}'::jsonb,
     'Magnezi kontribuon në funksionimin normal të muskujve dhe në ekuilibrin e elektrolitëve.',
     'Magnesium contributes to normal muscle function and to electrolyte balance.',
     null, null),

    /*
     * The other direction, and the reason `weight_delta` accepts a negative number. Someone who
     * does not train has no particular need of a sports supplement, and a protocol that opens with
     * creatine for a sedentary customer reads as a shop selling rather than advising.
     *
     * A demotion, not an exclusion: they may still want it, and it stays available as a swap.
     */
    ('creatine', 35,
     '{"activity":["ulur"]}'::jsonb,
     '{"weight_delta":-30}'::jsonb,
     'Kreatina studiohet kryesisht te stërvitja me intensitet të lartë, prandaj e peshojmë më poshtë.',
     'Creatine is studied mainly in high-intensity training, so we weight it lower.',
     null, null),

    ('whey-protein', 36,
     '{"activity":["ulur"]}'::jsonb,
     '{"weight_delta":-20}'::jsonb,
     'Pa stërvitje të rregullt, proteina shtesë ka më pak rëndësi se ushqimi i përditshëm.',
     'Without regular training, extra protein matters less than everyday food.',
     null, null),

    -- ── Body mass ────────────────────────────────────────────────────────────
    /*
     * The serving hint again, this time keyed on the weight bands rather than activity — so a
     * heavier customer who does not train still sees the note if protein reaches their protocol
     * for another reason.
     *
     * No rule anywhere combines weight with height. That would be BMI, and assigning somebody a
     * BMI category is a health assessment this shop is not qualified to make (docs/15 §9).
     */
    ('whey-protein', 40,
     '{"weight_bands":["90_104","105_plus"]}'::jsonb,
     '{"servings_hint":true}'::jsonb,
     'Nevoja për proteinë ndjek masën e trupit.',
     'Protein needs track body mass.',
     null, null),

    ('plant-protein', 41,
     '{"weight_bands":["90_104","105_plus"]}'::jsonb,
     '{"servings_hint":true}'::jsonb,
     'Nevoja për proteinë ndjek masën e trupit.',
     'Protein needs track body mass.',
     null, null),

    -- ── Combinations, where the personalisation earns its keep ────────────────
    /*
     * A training woman of menstruating age: endurance training raises iron turnover on top of
     * menstrual losses, and this is the combination where the two separate rules understate it.
     * The deltas stack, which is the point of applying rules in sequence rather than picking one.
     */
    ('iron', 50,
     '{"sexes":["femer"],"age_bands":["18_29","30_39","40_49"],"activity":["i_rregullt","intensiv"]}'::jsonb,
     '{"weight_delta":15}'::jsonb,
     'Stërvitja e rregullt shtohet mbi humbjet mujore.',
     'Regular training adds to monthly losses.',
     null, null),

    /*
     * Sedentary and over fifty: the muscle-mass decline is steepest exactly where the stimulus is
     * least. Protein is the nutritional half of the answer and the copy says what the other half
     * is, because a supplement that is offered without the context is being oversold.
     */
    ('whey-protein', 51,
     '{"age_bands":["50_64","65_plus"],"activity":["ulur","i_lehte"]}'::jsonb,
     '{"weight_delta":20}'::jsonb,
     'Masa muskulore bie natyrshëm me moshën; proteina dhe lëvizja kundër rezistencës punojnë bashkë.',
     'Muscle mass declines naturally with age; protein and resistance movement work together.',
     null, null),

    /*
     * The one `require` in the set, and the clearest case for the mechanism.
     *
     * B12 occurs in animal foods, so a vegan diet is the textbook shortfall — and it has nothing
     * to do with whichever goal brought them here. Without `require` it would lose every slot to
     * higher-scoring candidates, and the single most relevant item for that customer would be the
     * one thing missing from their protocol.
     *
     * Diet is not one of the profile bands, so this is keyed on nothing and fires for everybody;
     * the engine drops it at product resolution for anyone whose diet has a compliant B12 product,
     * which is all of them. It earns its place by guaranteeing the slot, not by filtering.
     */
    ('vitamin-b12', 60,
     '{}'::jsonb,
     '{"require":true}'::jsonb,
     'B12 gjendet kryesisht në ushqime shtazore, prandaj e mbajmë gjithmonë në listë.',
     'B12 occurs mainly in animal foods, so we always keep it on the list.',
     null, null)
)
insert into protocol_profile_rules
  (config_id, ingredient_id, when_profile, effect, reason_i18n, caution_i18n, sort_order)
select
  t.id,
  i.id,
  s.when_profile,
  s.effect,
  jsonb_build_object('sq', s.reason_sq, 'en', s.reason_en),
  case when s.caution_sq is null then null
       else jsonb_build_object('sq', s.caution_sq, 'en', s.caution_en) end,
  s.sort_order
from seeded s
cross join target t
left join ingredients i on i.slug = s.ingredient_slug
-- A rule naming an ingredient that is not in this environment is skipped, not fatal (docs/13 §T2).
where (s.ingredient_slug is null or i.id is not null)
  and not exists (
    select 1 from protocol_profile_rules existing
    where existing.config_id = t.id and existing.sort_order = s.sort_order
  );

-- -----------------------------------------------------------------------------
-- Flags the rules depend on
-- -----------------------------------------------------------------------------

update ingredients
set scales_with_body_weight = true
where slug in ('whey-protein', 'plant-protein', 'creatine');
