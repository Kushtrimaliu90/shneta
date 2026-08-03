-- ---------------------------------------------------------------------------------------------
-- The marketplace terms merchants accept at onboarding (docs/16 §10).
--
-- A `pages` row, so it is served by the same route, editor and markdown pipeline as the customer
-- legal pages — and so a merchant can read the version they accepted at any time.
--
-- **Versioned.** `merchants.terms_version` stores which version a merchant accepted and
-- `terms_accepted_at` when. Changing these terms means bumping `MARKETPLACE_TERMS_VERSION` in
-- `src/features/merchants/terms.ts` and re-collecting acceptance; editing the text in place would
-- leave every existing merchant recorded as having agreed to something they never saw.
--
-- ---------------------------------------------------------------------------------------------
-- READ THIS BEFORE THE FIRST MERCHANT SIGNS
--
-- Written by engineering, not by a lawyer. It is accurate about what the software does — the
-- commission arithmetic, the payout cycle, the shipping options, the data the merchant actually
-- receives — and it follows the shape a Kosovo B2B intermediation agreement takes. It is not a
-- substitute for review by someone qualified in Kosovo commercial and data protection law, and a
-- merchant relationship is a contract with money and liability in it.
--
-- The trader identification block carries `[BIZNESI: plotëso]` for the same reason the customer
-- terms do: those are facts only the owner has.
-- ---------------------------------------------------------------------------------------------

insert into pages (slug, title, body, status) values (
  'marketplace-terms',
  jsonb_build_object(
    'sq', 'Kushtet e Tregut BioCode',
    'en', 'BioCode Marketplace Terms'
  ),
  jsonb_build_object('sq', $md$
**Versioni 1.0**

Këto kushte rregullojnë marrëdhënien mes BioCode dhe një shitësi të tretë ("Shitësi") që ofron
produkte në platformën BioCode. Duke i pranuar këto kushte gjatë regjistrimit, Shitësi lidh një
kontratë me BioCode.

## 1. Palët

**BioCode:** [BIZNESI: plotëso — emri i regjistruar, numri unik i biznesit, numri fiskal, adresa]

**Shitësi:** subjekti i identifikuar në aplikimin e miratuar, i regjistruar në ARBK.

## 2. Çfarë është platforma, dhe çfarë nuk është

BioCode operon një dyqan online. Shitësi **nuk** hap dyqan të vetin brenda platformës: ofertat e
Shitësit lidhen me faqet e produkteve që i krijon dhe i zotëron BioCode.

**Kontrata e shitjes është mes BioCode dhe klientit.** Klienti blen nga BioCode, paguan BioCode-in,
dhe të gjitha të drejtat e tij si konsumator janë ndaj BioCode-it. Shitësi është furnizues dhe
përmbushës i porosisë, jo shitës ndaj klientit fundor. Kjo është arsyeja pse Shitësi nuk ka kontakt
të drejtpërdrejtë me klientin (neni 8).

## 3. Ofertat dhe katalogu

Shitësi mund të ofrojë vetëm produkte që ekzistojnë në katalogun e BioCode-it. Për një produkt që
nuk ekziston, Shitësi dërgon një **propozim**; BioCode vendos nëse e krijon faqen e produktit.

Shitësi **nuk mund** të ndryshojë tekstin, fotografitë, përbërësit ose pretendimet në një faqe
produkti aktive. Ato i miraton menaxheri i pajtueshmërisë së BioCode-it dhe janë përgjegjësi e
BioCode-it ndaj rregullatorit.

Çdo ofertë kalon në shqyrtim para se të shfaqet. BioCode mund të refuzojë ose pezullojë një ofertë
pa detyrimin e një arsyeje tregtare, por gjithmonë me një arsye të shkruar.

**Kutia e blerjes:** kur BioCode ka stok, porosia përmbushet nga BioCode. Përndryshe zgjedhet
oferta më e lirë në stok. Shitësi nuk ka të drejtë të garantuar mbi shitjen e një produkti.

## 4. Autenticiteti dhe legaliteti i importit

Shitësi garanton se çdo produkt që ofron:

- është origjinal, i furnizuar nga prodhuesi ose nga një distributor i autorizuar;
- është i importuar dhe i deklaruar në përputhje me legjislacionin doganor dhe tatimor të Kosovës;
- ka të gjitha lejet e nevojshme, përfshirë licencën e importit kur kërkohet për suplemente;
- ka të paktën **gjashtë muaj** afat të mbetur deri në skadencë në momentin e dërgesës;
- ka etiketë të paprishur dhe vulë origjinale.

Shitja e produkteve të falsifikuara, të importuara pa deklarim, ose të skaduara është arsye për
pezullim të menjëhershëm dhe për kërkesë të dëmshpërblimit.

## 5. Pretendimet shëndetësore

Suplementet ushqimore janë ushqim, jo ilaç. Në çdo tekst që Shitësi dërgon — propozime, përshkrime,
komunikim me BioCode-in — ndalohen pretendimet se një produkt kuron, mjekon, parandalon ose shëron
një gjendje shëndetësore.

Ky nuk është preferencë stili: është kërkesë ligjore dhe BioCode e zbaton automatikisht. Teksti me
folje të ndaluara refuzohet në momentin e ruajtjes.

## 6. Komisioni dhe shlyerja

BioCode mban një **komision** të përqindjes së rënë dakord, të caktuar gjatë shqyrtimit të aplikimit
dhe të regjistruar në profilin e Shitësit.

Komisioni llogaritet mbi **nëntotalin e artikujve** të përmbushjes, jo mbi kostot e dërgesës.

> Shembull: një artikull €10.00 me komision 10% → BioCode mban €1.00, Shitësi merr €9.00.

Komisioni mund të ndryshojë vetëm me njoftim të paraprakë me shkrim prej të paktën **30 ditësh**.
Ndryshimi nuk zbatohet për porositë e konfirmuara para datës së hyrjes në fuqi.

### Kostoja e dërgesës

Kush e mbulon kostoja e dërgesës për përmbushjet e Shitësit caktohet nga BioCode dhe regjistrohet
në profilin e Shitësit. Ka tri mundësi:

| Opsioni      | Efekti                                                                    |
| ------------ | ------------------------------------------------------------------------- |
| **BioCode**  | BioCode e mbulon. Nga Shitësi nuk zbritet asgjë                            |
| **Shitësi**  | Kostoja zbritet nga shuma që i takon Shitësit gjatë shlyerjes             |
| **Klienti**  | E mbulon tarifa e dërgesës që klienti ka paguar. Nga Shitësi nuk zbritet   |

Opsioni i zbatuar dhe shuma e zbritur shfaqen te secila përmbushje në portal.

### Pagesa në dorëzim

Në rastin e zakonshëm, korrieri i BioCode-it mbledh paranë në dorëzim, sepse klienti ka blerë nga
BioCode. Shuma e mbledhur i takon BioCode-it dhe Shitësit i lind e drejta e shumës neto.

Kur Shitësi dërgon me korrierin e vetin dhe mbledh vetë paranë, ndodh e kundërta: Shitësi mban
shumën e mbledhur dhe i detyrohet BioCode-it komisionin. Në të dyja rastet, bilanci është shuma e
regjistrimeve në librin e llogarive.

### Cikli i shlyerjes

Shlyerja bëhet **çdo dy javë**, përveç kur bihet dakord ndryshe. BioCode nxjerr një pasqyrë për
periudhën me çdo përmbushje, komision, kthim dhe rregullim, dhe kryen transfertën bankare në
llogarinë IBAN të regjistruar nga Shitësi.

Pasqyra është e njëjta që shihet nga BioCode dhe nga Shitësi. Kundërshtimet ndaj një pasqyre duhet
të paraqiten brenda **14 ditësh**; pas kësaj pasqyra konsiderohet e pranuar.

BioCode mund të mbajë një shlyerje kur ka një hetim të hapur për autenticitetin, kur ka kthime të
pazgjidhura, ose kur të dhënat bankare janë ndryshuar gjatë periudhës — në rastin e fundit vetëm sa
për ta verifikuar ndryshimin.

## 7. Afati i përgatitjes dhe përmbushja

Shitësi duhet të **pranojë ose refuzojë** një caktim brenda **24 orëve**. Pa përgjigje, caktimi
kalon te një shitës tjetër.

Pas pranimit, Shitësi duhet ta dorëzojë paketën te korrieri brenda afatit të përgatitjes që ka
deklaruar për ofertën, dhe në çdo rast brenda afatit maksimal të përcaktuar nga BioCode.

Shitësi vendos statusin deri në *dërguar*. Statusin *dorëzuar* e vendos vetëm BioCode, mbi bazën e
konfirmimit të korrierit.

Paketa duhet të përmbajë vetëm artikujt e kësaj përmbushjeje, pa material marketingu të Shitësit,
pa fatura të Shitësit dhe pa të dhëna kontakti të Shitësit. Fletëpaketimi lëshohet nga BioCode.

## 8. Komunikimi me klientin

Shitësi **nuk merr** adresën e emailit të klientit dhe **nuk komunikon** me klientin — jo me email,
jo me telefon, jo me shënim në paketë. Çdo komunikim me klientin bëhet nga BioCode.

Shitësi merr emrin, numrin e telefonit dhe adresën e dorëzimit, dhe vetëm pasi caktimi është
konfirmuar. Numri i telefonit lejohet të përdoret vetëm nga korrieri për dorëzimin.

Problemet — artikull i gabuar, i dëmtuar, i mangët — raportohen te BioCode përmes portalit.

## 9. Kthimet dhe përgjegjësia

Klienti ka të drejtat e tij të kthimit ndaj BioCode-it, sipas faqes [Dërgesa dhe
kthimet](/legal/shipping-returns).

Kur kthimi ndodh sepse produkti ishte me të meta, i gabuar, i skaduar ose i falsifikuar,
përgjegjësia është e Shitësit: komisioni kthehet, shuma e shitjes anulohet dhe kostoja e kthimit
zbritet nga shlyerja e Shitësit.

Kur klienti tërhiqet pa arsye brenda afatit ligjor, shuma e shitjes anulohet dhe stoku i kthehet
Shitësit; kostoja e dërgesës ndjek rregullin e nenit 6.

## 10. Mbrojtja e të dhënave

Për të dhënat e dorëzimit që merr (emri, telefoni, adresa), Shitësi është **përpunues** dhe BioCode
kontrollues, sipas Ligjit Nr. 06/L-082.

Shitësi:

- i përdor këto të dhëna **vetëm** për të përmbushur porosinë përkatëse;
- nuk i ruan pas afatit që kërkon legjislacioni tatimor;
- nuk i përdor për marketing, nuk i shet dhe nuk i ndan me palë të treta përveç korrierit;
- njofton BioCode-in **brenda 24 orëve** për çdo shkelje të sigurisë që i prek;
- i fshin me kërkesë të BioCode-it, përveç atyre që ligji e detyron ta mbajë.

## 11. Pezullimi dhe përfundimi

BioCode mund të pezullojë ofertat e Shitësit kur:

- ka dyshim të bazuar për autenticitetin ose legalitetin e importit;
- afatet e përgatitjes ose norma e pranimit bien nën pragjet e publikuara në portal;
- ka ankesa të përsëritura të klientëve për artikujt e Shitësit;
- të dhënat e regjistrimit ose bankare rezultojnë të pasakta;
- shkelen nenet 4, 5, 8 ose 10.

Pezullimi nuk është përfundim. Ofertat ndalojnë së shfaqur, porositë e pranuara duhet të
përmbushen, dhe shlyerja e periudhës kryhet normalisht.

Secila palë mund ta përfundojë marrëdhënien me njoftim **30 ditë** përpara. Porositë e pranuara para
njoftimit duhet të përmbushen. Përfundimi nuk shuan detyrimet financiare të asnjërës palë.

## 12. Ligji i zbatueshëm

Këto kushte rregullohen nga legjislacioni i Republikës së Kosovës. Mosmarrëveshjet zgjidhen nga
gjykatat kompetente në Prishtinë, pasi palët të kenë provuar një zgjidhje të drejtpërdrejtë.

## 13. Ndryshimet

BioCode mund t'i përditësojë këto kushte me njoftim **30 ditë** përpara. Vazhdimi i shitjes pas
datës së hyrjes në fuqi nënkupton pranimin e versionit të ri. Versioni që Shitësi ka pranuar dhe
data e pranimit ruhen dhe shfaqen në portal.
$md$, 'en', $md$
**Version 1.0**

These terms govern the relationship between BioCode and a third-party seller ("the Merchant")
offering products on the BioCode platform. By accepting them during onboarding, the Merchant enters
into a contract with BioCode.

## 1. The parties

**BioCode:** [BIZNESI: plotëso — registered name, business number, fiscal number, address]

**The Merchant:** the entity identified in the approved application, registered with the ARBK.

## 2. What the platform is, and what it is not

BioCode operates an online shop. The Merchant does **not** open its own shop inside the platform:
the Merchant's offers attach to product pages BioCode creates and owns.

**The contract of sale is between BioCode and the customer.** The customer buys from BioCode, pays
BioCode, and holds every consumer right against BioCode. The Merchant is a supplier and fulfiller,
not a seller to the end customer. That is why the Merchant has no direct contact with the customer
(clause 8).

## 3. Offers and the catalogue

The Merchant may offer only products that already exist in BioCode's catalogue. For a product that
does not, the Merchant submits a **proposal**; BioCode decides whether to create the page.

The Merchant **may not** alter the copy, images, ingredients or claims on a live product page. Those
are approved by BioCode's compliance manager and are BioCode's responsibility to the regulator.

Every offer is reviewed before it appears. BioCode may reject or pause an offer without owing a
commercial justification, but always with a written reason.

**The buy box:** where BioCode holds stock, BioCode fulfils. Otherwise the cheapest in-stock offer
is selected. The Merchant has no guaranteed right to sales of any product.

## 4. Authenticity and lawful import

The Merchant warrants that every product it offers:

- is genuine, sourced from the manufacturer or an authorised distributor;
- has been imported and declared in accordance with Kosovo customs and tax law;
- holds every required permit, including an import licence where supplements require one;
- has at least **six months** remaining before expiry at the time of dispatch;
- has an intact label and an unbroken original seal.

Selling counterfeit, undeclared or expired goods is grounds for immediate suspension and for a claim
in damages.

## 5. Health claims

Food supplements are food, not medicine. In any text the Merchant submits — proposals, descriptions,
correspondence with BioCode — claims that a product cures, treats, prevents or heals a condition are
prohibited.

This is not a style preference: it is a legal requirement, and BioCode enforces it automatically.
Text containing prohibited verbs is rejected at the point of saving.

## 6. Commission and settlement

BioCode retains a **commission** at the agreed percentage, set during review of the application and
recorded on the Merchant's profile.

Commission is calculated on the **item subtotal** of the fulfilment, never on shipping costs.

> Example: a €10.00 item at 10% commission → BioCode retains €1.00, the Merchant receives €9.00.

Commission may change only on at least **30 days'** prior written notice. A change does not apply to
orders confirmed before the effective date.

### Shipping cost

Who bears the shipping cost on the Merchant's fulfilments is decided by BioCode and recorded on the
Merchant's profile. There are three options:

| Option       | Effect                                                              |
| ------------ | ------------------------------------------------------------------- |
| **BioCode**  | BioCode bears it. Nothing is deducted from the Merchant             |
| **Merchant** | The cost is deducted from the Merchant's due at settlement          |
| **Customer** | Covered by the delivery fee the customer paid. Nothing is deducted  |

The option applied and any amount deducted are shown against each fulfilment in the portal.

### Cash on delivery

In the ordinary case BioCode's courier collects the cash on delivery, because the customer bought
from BioCode. The collected amount belongs to BioCode and the Merchant becomes entitled to its net
sum.

Where the Merchant ships with its own courier and collects the cash itself, the reverse applies: the
Merchant keeps the collected amount and owes BioCode the commission. In both cases the balance is
the sum of the ledger entries.

### The settlement cycle

Settlement is **fortnightly** unless agreed otherwise. BioCode issues a statement for the period
listing every fulfilment, commission, return and adjustment, and transfers the net by bank transfer
to the IBAN the Merchant has registered.

The statement is the same one both BioCode and the Merchant see. A statement must be disputed within
**14 days**; after that it is treated as accepted.

BioCode may withhold a settlement while an authenticity investigation is open, while returns are
unresolved, or where bank details changed during the period — in the last case only for as long as
verifying the change takes.

## 7. Handling time and fulfilment

The Merchant must **accept or decline** an assignment within **24 hours**. Without a reply, the
assignment passes to another seller.

Once accepted, the Merchant must hand the parcel to the courier within the handling time declared on
the offer, and in any case within the maximum BioCode sets.

The Merchant sets status as far as *shipped*. Only BioCode sets *delivered*, on courier confirmation.

The parcel must contain only the items of that fulfilment: no Merchant marketing material, no
Merchant invoice, no Merchant contact details. The packing slip is issued by BioCode.

## 8. Customer communication

The Merchant **does not receive** the customer's email address and **does not communicate** with the
customer — not by email, not by phone, not by a note in the parcel. All customer communication is
BioCode's.

The Merchant receives the name, phone number and delivery address, and only once the assignment is
confirmed. The phone number may be used only by the courier, for delivery.

Problems — wrong item, damaged, short — are raised with BioCode through the portal.

## 9. Returns and liability

The customer holds their return rights against BioCode, as set out on the [Shipping and
returns](/en/legal/shipping-returns) page.

Where a return arises because the product was faulty, wrong, expired or counterfeit, liability is
the Merchant's: the commission is reversed, the sale is cancelled, and the cost of the return is
deducted from the Merchant's settlement.

Where the customer withdraws without reason within the statutory period, the sale is cancelled and
the stock returns to the Merchant; the shipping cost follows the rule in clause 6.

## 10. Data protection

For the delivery data it receives (name, phone, address) the Merchant is a **processor** and BioCode
the controller, under Law No. 06/L-082.

The Merchant:

- uses that data **only** to fulfil the order in question;
- does not retain it beyond the period tax law requires;
- does not use it for marketing, does not sell it, and does not share it with any third party other
  than the courier;
- notifies BioCode **within 24 hours** of any security breach affecting it;
- deletes it on BioCode's request, except where law requires retention.

## 11. Suspension and termination

BioCode may suspend the Merchant's offers where:

- there is reasonable doubt about authenticity or lawful import;
- handling times or the acceptance rate fall below the thresholds published in the portal;
- there are repeated customer complaints about the Merchant's items;
- registration or bank details prove inaccurate;
- clauses 4, 5, 8 or 10 are breached.

Suspension is not termination. Offers stop appearing, accepted orders must still be fulfilled, and
the period's settlement is carried out normally.

Either party may end the relationship on **30 days'** notice. Orders accepted before notice must be
fulfilled. Termination does not extinguish either party's financial obligations.

## 12. Governing law

These terms are governed by the law of the Republic of Kosovo. Disputes are resolved by the competent
courts in Prishtina, after the parties have attempted a direct resolution.

## 13. Changes

BioCode may update these terms on **30 days'** notice. Continuing to sell after the effective date
constitutes acceptance of the new version. The version the Merchant accepted and the date of
acceptance are stored and shown in the portal.
$md$),
  'published'
)
on conflict (slug) do nothing;
