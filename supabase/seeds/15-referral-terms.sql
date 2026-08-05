-- ---------------------------------------------------------------------------------------------
-- The referral programme terms (docs/17 §6).
--
-- A `pages` row, so it goes through the same route, editor and markdown pipeline as the other legal
-- pages, and so the admin can correct it without a deploy.
--
-- It exists at step 3 rather than step 8 because step 3 is what puts a customer-visible invite field
-- on the sign-up form and the account page, and both link here. A programme that asks somebody to
-- name who invited them without telling them what that means is not one to ship, and a link to a
-- page that does not exist yet is worse than no link.
--
-- ---------------------------------------------------------------------------------------------
-- READ THIS BEFORE THE PROGRAMME GOES LIVE
--
-- Written by engineering, not by a lawyer. It is accurate about what the software does — the rate,
-- the twelve-month clock, what counts as eligible spend, when points post, what a refund does — and
-- it says plainly what one customer learns about another, which is the part §0.2 exists to protect.
-- It is not a substitute for review by someone qualified in Kosovo consumer and data protection law.
--
-- Two numbers here must match `settings.referral` and `settings.loyalty`. If the rate or the point
-- value changes, this text is wrong until it is edited: 1% and "100 points = €1" are written out
-- because a customer cannot read a settings table, and a promotional page that hedges every number
-- into a variable tells them nothing.
-- ---------------------------------------------------------------------------------------------

insert into pages (slug, title, body, status) values (
  'referral-terms',
  jsonb_build_object(
    'sq', 'Kushtet e programit të ftesave',
    'en', 'Referral programme terms'
  ),
  jsonb_build_object('sq', $md$
Programi i ftesave i BioCode shpërblen klientët që i sjellin klientë të rinj dyqanit. Këto kushte
janë pjesë e [Kushteve të përgjithshme](/legal/terms) dhe lexohen bashkë me
[Politikën e privatësisë](/legal/privacy).

## 1. Kush mund të marrë pjesë

Çdo klient me llogari në BioCode ka një kod ftese personal në formën `BIO-XXXXX`. Kodi është i
përhershëm dhe nuk mund të ndryshohet. Programi është për konsumatorë individualë; kodet nuk mund të
publikohen në reklama me pagesë, në faqe kuponash, e as të shiten.

## 2. Si lidhet një ftesë

Klienti i ri shkruan kodin gjatë regjistrimit, ose ndjek linkun e ftesës. Kodi mund të shtohet edhe
më vonë nga llogaria — **derisa të bëhet porosia e parë**. Pas porosisë së parë ftesa nuk mund të
regjistrohet më.

Një klient ka **një ftues, përgjithmonë**. Ftesa nuk mund të zëvendësohet apo transferohet. Një ftues
mund të ftojë sa klientë të dojë.

Nuk lidhen ftesa mes dy llogarive që kanë të njëjtin email ose numër telefoni, e as kur klienti
shkruan kodin e vetvetes.

## 3. Miratimi

Ftesa regjistrohet si **në pritje** dhe miratohet nga BioCode. Deri në miratim nuk fitohen pikë.
Miratimi mund të mos ndodhë kur ka arsye për të dyshuar se llogaritë i përkasin të njëjtit person.

## 4. Sa fitohet

Për 12 muaj nga data e miratimit, ftuesi fiton **1% të shpenzimit të pranueshëm** të klientit të
ftuar, të paguar në pikë besnikërie: **100 pikë vlejnë 1 €**. Kështu 100 € shpenzim i pranueshëm
jep 100 pikë, ose 1 €.

**Shpenzim i pranueshëm** është vlera e produkteve në porosi minus zbritjet. Nuk përfshihet transporti.
Porosia numëron vetëm kur **dorëzohet**, dhe vetëm kur dorëzimi ndodh brenda 12 muajve. Porositë nën
10 € nuk numërohen. Porositë e bëra si vizitor, pa llogari, nuk numërohen.

Pikët postohen në llogari një herë në muaj, si një zë i vetëm. Ky është një zgjedhje e privatësisë:
shih pikën 6.

## 5. Kufijtë, kthimet dhe anulimet

Një ftesë jep maksimum **20 000 pikë (200 €)** brenda 12 muajve.

Kur një porosi kthehet ose rimbursohet, pikët përkatëse zbriten. Bilanci nuk shkon nën zero; pjesa e
mbetur zbritet nga fitimet e mëvonshme të së njëjtës ftesë.

Pikët kanë të njëjtat kushte si pikët e besnikërisë dhe shpenzohen sipas
[Kushteve të përgjithshme](/legal/terms).

## 6. Çka mëson ftuesi për klientin e ftuar

Ftuesi shikon **vetëm**: emrin e parë dhe shkronjën e mbiemrit, muajin e regjistrimit, statusin e
ftesës, ditët e mbetura, dhe totalin e pikëve të vetes.

Ftuesi **nuk** shikon: çka ka blerë klienti i ftuar, sa ka shpenzuar, kur ka blerë, sa porosi ka
bërë, e as emailin, telefonin apo adresën. Kjo nuk është politikë e brendshme që mund të hiqet — sistemi
nuk e ka një rrugë ku kjo informatë të dalë.

Klienti i ftuar shikon emrin e parë dhe shkronjën e mbiemrit të ftuesit.

## 7. Keqpërdorimi

BioCode mund të ndalojë një ftesë, të gjitha ftesat e një ftuesi, ose të heqë pikët e fituara, kur
ka provë të llogarive të krijuara për të shfrytëzuar programin — për shembull llogari të shumta të
së njëjtit person, ose porosi të bëra vetëm për të prodhuar pikë dhe të kthyera më pas.

Ndalimi e ndal fitimin e mëtejmë. Pikët e fituara më parë mbeten, përveç kur hiqen veçmas për arsye
të keqpërdorimit.

## 8. Ndryshimet

BioCode mund të ndryshojë përqindjen, kufijtë ose kohëzgjatjen, ose të ndalojë programin. Ndryshimi
vlen **për të ardhmen**: ftesat e miratuara para ndryshimit vazhdojnë me kushtet e tyre deri në fund
të 12 muajve.

## 9. Kontakti

Për pyetje: [BIZNESI: plotëso — email dhe telefon i shërbimit të klientit].
$md$, 'en', $md$
The BioCode referral programme rewards customers who bring new customers to the shop. These terms
form part of the [general Terms](/en/legal/terms) and are read together with the
[Privacy policy](/en/legal/privacy).

## 1. Who can take part

Every customer with a BioCode account has a personal invite code in the form `BIO-XXXXX`. The code is
permanent and cannot be changed. The programme is for individual consumers: codes may not be placed
in paid advertising or on coupon sites, and may not be sold.

## 2. How a referral is linked

The new customer enters the code while registering, or follows the invite link. A code can also be
added later from the account — **until the first order is placed**. After the first order a referral
can no longer be registered.

A customer has **one referrer, for ever**. A referral cannot be replaced or transferred. A referrer
may invite any number of customers.

No referral is linked between two accounts sharing an email address or phone number, nor when a
customer enters their own code.

## 3. Approval

A referral is recorded as **pending** and is approved by BioCode. No points are earned before
approval. Approval may be withheld where there is reason to believe the accounts belong to the same
person.

## 4. What is earned

For 12 months from the date of approval, the referrer earns **1% of the referred customer's eligible
spend**, paid in loyalty points: **100 points are worth €1**. So €100 of eligible spend earns 100
points, or €1.

**Eligible spend** is the value of the products in an order less any discounts. Shipping is not
included. An order counts only once it is **delivered**, and only if delivery falls within the 12
months. Orders under €10 do not count. Orders placed as a guest, without an account, do not count.

Points are posted to the account once a month, as a single entry. That is a privacy choice: see
clause 6.

## 5. Limits, returns and cancellations

A single referral earns at most **20,000 points (€200)** within the 12 months.

When an order is returned or refunded, the corresponding points are deducted. A balance never goes
below zero; any remainder is deducted from later earnings on the same referral.

The points carry the same conditions as loyalty points and are spent under the
[general Terms](/en/legal/terms).

## 6. What a referrer learns about a referred customer

A referrer sees **only**: a first name and a surname initial, the month of registration, the status
of the referral, the days remaining, and their own points totals.

A referrer does **not** see: what the referred customer bought, how much they spent, when they
bought, how many orders they placed, or their email address, phone number or address. This is not an
internal policy that could be relaxed — the system has no path by which that information can leave it.

The referred customer sees the referrer's first name and surname initial.

## 7. Abuse

BioCode may stop a referral, stop all referrals belonging to one referrer, or remove points already
earned, where there is evidence of accounts created to exploit the programme — for example multiple
accounts belonging to one person, or orders placed only to generate points and then returned.

Stopping a referral ends further earning. Points earned earlier remain, unless separately removed for
abuse.

## 8. Changes

BioCode may change the rate, the limits or the duration, or end the programme. A change applies
**prospectively**: referrals approved before the change continue on their existing terms until the end
of their 12 months.

## 9. Contact

Questions: [BIZNESI: plotëso — customer service email and phone].
$md$),
  'published'
)
/*
 * Never overwrites what is already there.
 *
 * Seed 06 can afford a cleverer guard — it replaces a placeholder stub only while that stub still
 * carries a `[LEGAL: review]` marker — because `seed.sql` inserts the stub and 06 replaces it. This page
 * has no stub: the row either does not exist, or it is this text, or it is this text after somebody
 * edited it in the admin panel. Only the first case wants writing, so `do nothing` says exactly that.
 *
 * The marker itself is deliberately **not** in the body. It is a predicate, not prose: rendered on a
 * live legal page it reads as a mistake rather than as a note to a reviewer. That this text has not been
 * through a lawyer is tracked in docs/14, where the other unreviewed documents are.
 */
on conflict (slug) do nothing;
