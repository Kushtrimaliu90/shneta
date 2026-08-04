-- ---------------------------------------------------------------------------------------------
-- `/about` and the three legal pages (docs/05 §16, docs/11 §8).
--
-- Same mechanism as `05-goal-content.sql`: runs after `seed.sql` has inserted the rows, and every
-- statement is guarded on the placeholder still being present, so a copy edited in the admin is
-- never overwritten by a re-seed.
--
-- ---------------------------------------------------------------------------------------------
-- READ THIS BEFORE THE SHOP TAKES A REAL ORDER
--
-- This copy was **written by engineering, not by a lawyer.** It is accurate about what the
-- software actually does — the shipping prices, the payment methods, the data collected and the
-- processors it is sent to are all read off the implementation rather than assumed — and it
-- follows the shape that Kosovo's Law No. 06/L-034 on Consumer Protection and Law No. 06/L-082 on
-- Protection of Personal Data require of a distance seller.
--
-- It is not a substitute for review by someone qualified in Kosovo consumer and data protection
-- law. Checkout makes every customer tick a box accepting these terms, which is exactly why the
-- gap matters. docs/14 §14 tracks it as blocking.
--
-- The trader identification block carries a visible `[BIZNESI: plotëso]` marker. A distance
-- seller is legally required to identify itself — registered name, business number, fiscal
-- number, registered address — and those are facts only the owner has. Inventing them would be
-- worse than leaving the gap visible, and the admin content list flags any page still holding a
-- bracketed marker.
-- ---------------------------------------------------------------------------------------------

-- ── About ─────────────────────────────────────────────────────────────────────────────────────

update pages set body = jsonb_build_object('sq', $md$
## Biologjia jote ka një kod

BIOCODE është një dyqan suplementesh dhe një vend për të mësuar. E nisëm sepse blerja e suplementeve në Kosovë ishte më e vështirë sesa duhej: etiketa të papërkthyera, doza të fshehura pas fjalës "përzierje pronësore", dhe premtime që askush nuk i mbështet.

## Si punojmë

**Çdo përbërës i deklaruar.** Në faqen e secilit produkt do të gjesh listën e plotë të përbërësve dhe dozën për porcion. Nëse një produkt nuk e thotë se çfarë ka brenda dhe sa, nuk e shesim.

**Asnjë premtim që nuk qëndron.** Suplementet janë ushqim, jo ilaç. Ne shkruajmë se në çfarë kontribuon një lëndë ushqyese, jo se çfarë gjendjeje zgjidh. Kjo është edhe kërkesë ligjore, edhe mënyra e vetme e ndershme për ta bërë.

**Arsyeja, jo vetëm produkti.** Gjeneratori BioHack dhe faqet e qëllimeve shëndetësore ekzistojnë që të kuptosh pse diçka të propozohet — jo thjesht që ta shtosh në shportë.

## Ku jemi

Operojmë nga Prishtina dhe dërgojmë në të gjithë Kosovën. Pyetjet, ankesat dhe sugjerimet shkojnë te faqja e [kontaktit](/contact) dhe u përgjigjemi brenda dy ditëve të punës.

Përmbajtja në këtë faqe është edukative dhe nuk zëvendëson këshillën e një profesionisti shëndetësor.
$md$, 'en', $md$
## Your biology has a code

BIOCODE is a supplement shop and a place to learn. We started it because buying supplements in Kosovo was harder than it needed to be: untranslated labels, dosages hidden behind the words "proprietary blend", and promises nobody stands behind.

## How we work

**Every ingredient declared.** On each product page you will find the full ingredient list and the dose per serving. If a product will not say what is in it and how much, we do not sell it.

**No promises that do not hold.** Supplements are food, not medicine. We write what a nutrient contributes to, never what condition it resolves. That is both a legal requirement and the only honest way to do it.

**The reason, not just the product.** The BioHack generator and the health-goal pages exist so you understand why something is suggested — not merely so you add it to a basket.

## Where we are

We operate from Prishtina and deliver anywhere in Kosovo. Questions, complaints and suggestions go through the [contact page](/en/contact) and we reply within two working days.

The content on this site is educational and does not replace advice from a health professional.
$md$)
where slug = 'about' and body->>'sq' like '[CONTENT: replace]%';

-- ── Terms ─────────────────────────────────────────────────────────────────────────────────────

update pages set body = jsonb_build_object('sq', $md$
Këto kushte rregullojnë përdorimin e këtij dyqani dhe çdo porosi të bërë përmes tij. Duke vendosur një porosi, ti pranon këto kushte.

## 1. Kush jemi

[BIZNESI: plotëso — emri i regjistruar, numri unik i biznesit, numri fiskal, adresa e regjistruar]

Adresa e kontaktit: info@biocode.fit

## 2. Produktet

Produktet që shesim janë **suplemente ushqimore**, jo produkte mjekësore. Ato nuk e zëvendësojnë një dietë të larmishme dhe një mënyrë jetese të ekuilibruar. Informacioni në këtë faqe është edukativ dhe nuk përbën këshillë mjekësore.

Përshkrimet, përbërësit dhe dozat merren nga etiketa e prodhuesit. Përpiqemi t'i mbajmë të sakta dhe të përditësuara; nëse gjen një mospërputhje mes faqes dhe etiketës, etiketa e produktit që ke në dorë është ajo që vlen.

Fotografitë janë ilustruese. Paketimi mund të ndryshojë kur prodhuesi e ndryshon atë.

## 3. Çmimet

Të gjitha çmimet janë në **euro (EUR)** dhe **përfshijnë TVSH-në prej 18%**. Çmimi që shfaqet te produkti është çmimi që paguan për atë artikull; kostoja e dërgesës shtohet veçmas dhe tregohet para se ta konfirmosh porosinë.

Ruajmë të drejtën të ndryshojmë çmimet në çdo kohë. Ndryshimi nuk prek porositë e konfirmuara tashmë.

Nëse një çmim shfaqet qartazi gabim — për shembull nga një gabim teknik — nuk jemi të detyruar ta plotësojmë porosinë me atë çmim. Në atë rast të njoftojmë dhe ta kthejmë shumën e plotë nëse ke paguar.

## 4. Porositë

Një porosi bëhet kontratë kur ta konfirmojmë me email. Deri atëherë mund të anulohet duke na kontaktuar.

Mund të refuzojmë ose anulojmë një porosi nëse produkti nuk është më në stok, nëse të dhënat e dërgesës janë të paplota, ose nëse kemi arsye të besojmë se porosia nuk është e vërtetë. Nëse anulojmë pas pagesës, kthejmë të gjithë shumën.

Sasia maksimale për artikull në një porosi është 20 njësi.

## 5. Pagesa

Pranojmë **pagesë në dorëzim (cash)**. Paguan te korrieri kur e merr paketën.

Metoda me kartë aktivizohet kur të jetë gati; derisa të shfaqet në arkë, nuk është e disponueshme.

## 6. Dërgesa dhe kthimet

Kushtet e plota janë në faqen [Dërgesa dhe kthimet](/legal/shipping-returns), e cila është pjesë e këtyre kushteve.

## 7. Llogaria jote

Je përgjegjës për ruajtjen e fjalëkalimit tënd dhe për aktivitetin në llogarinë tënde. Na njofto menjëherë nëse dyshon se dikush tjetër ka hyrë në të.

Mund ta mbyllësh llogarinë në çdo kohë nga faqja e llogarisë. Të dhënat e porosive ruhen edhe pas mbylljes, sepse ligji për kontabilitetin e kërkon këtë.

## 8. Vlerësimet dhe përmbajtja e përdoruesit

Vlerësimet duhet të jenë përvoja jote e vërtetë me produktin. Nuk publikojmë vlerësime që përmbajnë gjuhë fyese, të dhëna personale të të tjerëve, ose pretendime shëndetësore për produktin. Ruajmë të drejtën të mos publikojmë ose të heqim një vlerësim që shkel këto rregulla.

## 9. Përgjegjësia

Nuk mbajmë përgjegjësi për dëme që rrjedhin nga përdorimi i një produkti në kundërshtim me udhëzimet e etiketës, ose nga mospërfillja e këshillës së një profesionisti shëndetësor.

Asgjë në këto kushte nuk kufizon të drejtat që ti ke si konsumator sipas legjislacionit të Republikës së Kosovës.

## 10. Ndryshimet

Mund t'i përditësojmë këto kushte. Data e ndryshimit të fundit shfaqet në krye të kësaj faqeje. Porositë rregullohen nga kushtet në fuqi në momentin kur janë bërë.

## 11. Ligji i zbatueshëm

Këto kushte rregullohen nga legjislacioni i Republikës së Kosovës. Mosmarrëveshjet zgjidhen nga gjykatat kompetente në Kosovë.

Nëse ke një ankesë, na shkruaj së pari te info@biocode.fit — përpiqemi ta zgjidhim drejtpërdrejt.
$md$, 'en', $md$
These terms govern the use of this shop and every order placed through it. By placing an order, you accept them.

## 1. Who we are

[BIZNESI: plotëso — registered name, business number, fiscal number, registered address]

Contact address: info@biocode.fit

## 2. The products

What we sell are **food supplements**, not medicinal products. They do not replace a varied diet and a balanced lifestyle. The information on this site is educational and does not constitute medical advice.

Descriptions, ingredients and dosages are taken from the manufacturer's label. We work to keep them accurate and current; if you find a discrepancy between the site and the label, the label on the product in your hand is the one that counts.

Photographs are illustrative. Packaging may change when the manufacturer changes it.

## 3. Prices

All prices are in **euro (EUR)** and **include VAT at 18%**. The price shown on a product is what you pay for that item; delivery cost is added separately and shown before you confirm the order.

We may change prices at any time. A change does not affect orders already confirmed.

If a price is displayed that is clearly wrong — through a technical error, for example — we are not obliged to fulfil the order at that price. In that case we will tell you and refund you in full if you have paid.

## 4. Orders

An order becomes a contract when we confirm it by email. Until then it can be cancelled by contacting us.

We may refuse or cancel an order if the product is no longer in stock, if the delivery details are incomplete, or if we have reason to believe the order is not genuine. If we cancel after payment, we refund in full.

The maximum quantity per item in one order is 20 units.

## 5. Payment

We accept **cash on delivery**. You pay the courier when the parcel arrives.

Card payment will be enabled when it is ready; until it appears at checkout, it is not available.

## 6. Delivery and returns

The full terms are on the [Shipping and returns](/en/legal/shipping-returns) page, which forms part of these terms.

## 7. Your account

You are responsible for keeping your password safe and for activity on your account. Tell us immediately if you suspect someone else has accessed it.

You may close your account at any time from the account page. Order records are retained after closure, because accounting law requires it.

## 8. Reviews and user content

Reviews must be your genuine experience of the product. We do not publish reviews containing abusive language, other people's personal data, or health claims about the product. We may decline to publish or may remove a review that breaks these rules.

## 9. Liability

We are not liable for harm arising from using a product contrary to the instructions on its label, or from disregarding the advice of a health professional.

Nothing in these terms limits the rights you have as a consumer under the law of the Republic of Kosovo.

## 10. Changes

We may update these terms. The date of the last change is shown at the top of this page. Orders are governed by the terms in force at the time they were placed.

## 11. Governing law

These terms are governed by the law of the Republic of Kosovo. Disputes are resolved by the competent courts in Kosovo.

If you have a complaint, write to us first at info@biocode.fit — we try to resolve things directly.
$md$)
where slug = 'terms' and body->>'sq' like '[LEGAL: review]%';

-- ── Privacy ───────────────────────────────────────────────────────────────────────────────────

update pages set body = jsonb_build_object('sq', $md$
Kjo politikë shpjegon çfarë të dhënash mbledhim, pse, sa gjatë i mbajmë dhe çfarë të drejtash ke. Zbatohet për këtë faqe dhe për porositë e bëra përmes saj.

## 1. Kontrolluesi i të dhënave

[BIZNESI: plotëso — emri i regjistruar dhe adresa e regjistruar]

Për çdo pyetje mbi të dhënat: info@biocode.fit

## 2. Çfarë mbledhim

**Kur bën një porosi:** emrin, emailin, numrin e telefonit, adresën e dërgesës dhe artikujt e porosisë. Këto na duhen për ta dërguar paketën dhe për ta lëshuar faturën.

**Kur hap llogari:** emailin, fjalëkalimin (i ruajtur i enkriptuar, nuk e shohim kurrë), emrin dhe adresat që ruan.

**Kur shfleton:** përmbajtjen e shportës dhe të listës së dëshirave, të lidhura me llogarinë tënde ose — nëse je vizitor — me një kod anonim të ruajtur në një cookie.

**Kur përdor gjeneratorin BioHack:** përgjigjet e tua për qëllimet shëndetësore, dietën, kafeinën, medikamentet dhe fazën e jetës, së bashku me protokollin e gjeneruar. Këto ruhen që ta rihapësh lidhjen më vonë.

**Kur shkruan një vlerësim ose një mesazh:** tekstin, emailin dhe emrin që jep.

**Automatikisht:** adresën IP dhe kohën e kërkesës, të përdorura vetëm për të kufizuar abuzimin (p.sh. dërgime të shumta të formularëve). Nuk e përdorim IP-në për profilizim.

**Nuk mbledhim** të dhëna pagese me kartë. Pagesa bëhet në dorëzim, në cash, te korrieri.

## 3. Baza ligjore

- **Ekzekutimi i kontratës** — porosia, dërgesa, fatura, kthimet.
- **Detyrimi ligjor** — ruajtja e të dhënave të faturimit sipas legjislacionit tatimor.
- **Pëlqimi** — buletini me email dhe cookie-t analitike. Mund ta tërheqësh në çdo kohë.
- **Interesi legjitim** — siguria e faqes dhe kufizimi i abuzimit.

## 4. Cookie-t

Përdorim cookie **thelbësore** që faqja të funksionojë: sesioni i hyrjes, shporta e vizitorit, zgjedhja jote për cookie-t. Këto nuk kërkojnë pëlqim sepse pa to faqja nuk punon.

Cookie-t **analitike** nuk ngarkohen derisa ta japësh pëlqimin te banda në fund të faqes. Nëse zgjedh "Vetëm ato të nevojshme", asnjë skript analitik nuk ekzekutohet — nuk ngarkohet fare, jo thjesht nuk përdoret.

## 5. Me kë i ndajmë

Vetëm me ofruesit që na duhen për të operuar:

- **Supabase** — baza e të dhënave dhe autentifikimi (serverë në Bashkimin Evropian).
- **Vercel** — hostimi i faqes.
- **Resend** — dërgimi i emaileve të porosive dhe i buletinit.
- **Korrieri** — emrin, adresën dhe numrin e telefonit, vetëm për dorëzimin.

Nuk shesim të dhëna personale. Nuk i ndajmë për reklamim.

## 6. Sa gjatë i mbajmë

- Të dhënat e porosive: sipas afatit që kërkon legjislacioni tatimor.
- Llogaria: derisa ta mbyllësh; pas kësaj mbeten vetëm të dhënat e faturimit.
- Shporta e vizitorit: 30 ditë.
- Mesazhet e kontaktit: 24 muaj.
- Buletini: derisa të çregjistrohesh.

## 7. Të drejtat e tua

Sipas Ligjit Nr. 06/L-082 për Mbrojtjen e të Dhënave Personale ke të drejtë:

- të kërkosh një kopje të të dhënave që mbajmë për ty;
- t'i korrigjosh nëse janë të pasakta;
- të kërkosh fshirjen e tyre;
- ta tërheqësh pëlqimin;
- të ankohesh te Agjencia për Informim dhe Privatësi.

Nga faqja e llogarisë mund ta shkarkosh vetë një kopje të plotë të të dhënave të tua, në çdo kohë. Për fshirje, na shkruaj te info@biocode.fit — përgjigjemi brenda 30 ditëve.

Vër re: fshirja nuk i heq të dhënat e faturimit që ligji na detyron t'i ruajmë. Ato anonimizohen aty ku është e mundur.

## 8. Siguria

Të gjitha lidhjet janë të enkriptuara (HTTPS). Aksesi te të dhënat kufizohet në nivel të bazës së të dhënave, jo vetëm në aplikacion. Fjalëkalimet ruhen të hashuara.

## 9. Fëmijët

Ky dyqan nuk u drejtohet personave nën 18 vjeç dhe nuk mbledhim me vetëdije të dhëna prej tyre.

## 10. Ndryshimet

Data e ndryshimit të fundit shfaqet në krye të kësaj faqeje.
$md$, 'en', $md$
This policy explains what data we collect, why, how long we keep it, and what rights you have. It applies to this site and to orders placed through it.

## 1. Data controller

[BIZNESI: plotëso — registered name and registered address]

For any question about data: info@biocode.fit

## 2. What we collect

**When you place an order:** your name, email, phone number, delivery address and the items ordered. We need these to send the parcel and issue the invoice.

**When you open an account:** your email, password (stored hashed — we never see it), name and any addresses you save.

**When you browse:** the contents of your cart and wishlist, linked to your account or — if you are a guest — to an anonymous token stored in a cookie.

**When you use the BioHack generator:** your answers about health goals, diet, caffeine, medication and life stage, together with the generated protocol. These are stored so you can reopen the link later.

**When you write a review or a message:** the text, and the email and name you give.

**Automatically:** your IP address and request time, used only to limit abuse (repeated form submissions, for example). We do not use IP for profiling.

**We do not collect** card payment data. Payment is cash on delivery, to the courier.

## 3. Legal basis

- **Performance of a contract** — the order, delivery, invoice and returns.
- **Legal obligation** — retention of invoicing records under tax law.
- **Consent** — the email newsletter and analytics cookies. You may withdraw it at any time.
- **Legitimate interest** — site security and abuse limiting.

## 4. Cookies

We use **essential** cookies so the site works: your login session, the guest cart, and your cookie choice itself. These need no consent because without them the site does not function.

**Analytics** cookies do not load until you consent through the banner at the bottom of the page. If you choose "Only what is needed", no analytics script runs — it is not loaded at all, rather than loaded and unused.

## 5. Who we share it with

Only the providers we need in order to operate:

- **Supabase** — database and authentication (servers in the European Union).
- **Vercel** — site hosting.
- **Resend** — sending order emails and the newsletter.
- **The courier** — your name, address and phone number, for delivery only.

We do not sell personal data. We do not share it for advertising.

## 6. How long we keep it

- Order records: for the period tax law requires.
- Account: until you close it; after that only invoicing records remain.
- Guest cart: 30 days.
- Contact messages: 24 months.
- Newsletter: until you unsubscribe.

## 7. Your rights

Under Law No. 06/L-082 on Protection of Personal Data you have the right to:

- request a copy of the data we hold about you;
- correct it if it is inaccurate;
- request its deletion;
- withdraw consent;
- complain to the Information and Privacy Agency.

From your account page you can download a complete copy of your data yourself, at any time. For deletion, write to info@biocode.fit — we respond within 30 days.

Note that deletion does not remove invoicing records the law requires us to keep. Those are anonymised where possible.

## 8. Security

All connections are encrypted (HTTPS). Access to data is restricted at the database level, not only in the application. Passwords are stored hashed.

## 9. Children

This shop is not directed at people under 18 and we do not knowingly collect data from them.

## 10. Changes

The date of the last change is shown at the top of this page.
$md$)
where slug = 'privacy' and body->>'sq' like '[LEGAL: review]%';

-- ── Shipping and returns ──────────────────────────────────────────────────────────────────────

update pages set body = jsonb_build_object('sq', $md$
## Ku dërgojmë

Dërgojmë në të gjithë territorin e Kosovës. Nuk dërgojmë jashtë vendit për momentin.

## Metodat dhe çmimet

| Metoda | Çmimi | Afati |
| --- | --- | --- |
| Standarde | 2,00 € | 1–3 ditë pune |
| Ekspres Prishtinë | 4,00 € | brenda ditës, vetëm në Prishtinë |

**Dërgesa standarde është falas për porositë mbi 30,00 €.** Kufiri llogaritet mbi vlerën e produkteve pas çdo zbritjeje.

Çmimi i dërgesës shfaqet në arkë para se ta konfirmosh porosinë. Nuk ka kosto të fshehura.

## Kur nisen porositë

Porositë e konfirmuara para orës 14:00 në ditë pune përgatiten po atë ditë. Porositë e së shtunës, të dielës dhe të festave zyrtare përgatiten ditën e parë të punës që vjen.

Afatet e mësipërme janë ditë pune dhe fillojnë kur paketa i dorëzohet korrierit, jo kur bëhet porosia.

## Pagesa

Pagesa bëhet **në dorëzim, në cash**, te korrieri. Kontrollo paketën para se të paguash.

## Nëse paketa nuk mbërrin

Korrieri provon dorëzimin dhe të kontakton në numrin që ke lënë. Nëse nuk mundet të të gjejë, paketa kthehet te ne dhe të njoftojmë me email.

Nëse porosia nuk ka mbërritur brenda afatit, na shkruaj te info@biocode.fit me numrin e porosisë dhe e ndjekim me korrierin.

## E drejta e tërheqjes — 14 ditë

Ke të drejtë ta anulosh porosinë brenda **14 ditësh** nga dita kur e ke marrë, pa dhënë asnjë arsye. Kjo është e drejta jote ligjore si konsumator në një shitje në distancë.

Për ta ushtruar, na shkruaj te info@biocode.fit brenda atij afati, me numrin e porosisë dhe artikujt që dëshiron të kthesh. Pastaj ke edhe 14 ditë të tjera për ta dërguar produktin mbrapa.

### Çfarë mund të kthehet

Produkti duhet të jetë **i pahapur dhe me vulën origjinale të paprekur.**

Suplementet ushqimore janë produkte higjienike të mbyllura. Sipas ligjit, e drejta e tërheqjes nuk zbatohet për produkte të tilla nëse vula është hequr pas dorëzimit — sepse pas hapjes ato nuk mund të rikthehen në shitje. Kjo nuk prek asnjë nga të drejtat e tua kur produkti është me të meta.

### Kthimi i parave

Kthejmë shumën e paguar për produktet brenda **14 ditësh** nga momenti kur e marrim paketën mbrapa dhe e kontrollojmë. Kostoja e dërgesës fillestare kthehet gjithashtu nëse anulon të gjithë porosinë.

Kostoja e kthimit të produktit është e jotja, përveç rasteve kur produkti ka të meta ose të është dërguar artikulli i gabuar.

## Produkte me të meta ose të gabuara

Nëse merr diçka të dëmtuar, të skaduar, ose të ndryshme nga ajo që porosite, na shkruaj **brenda 48 orëve** nga dorëzimi, me numrin e porosisë dhe një fotografi.

Në këto raste ta zëvendësojmë produktin ose ta kthejmë të gjithë shumën, përfshirë dërgesën, dhe kostoja e kthimit është e jona. Kjo vlen pavarësisht nëse vula është hequr.

## Datat e skadencës

Çdo produkt që dërgojmë ka të paktën **gjashtë muaj** të mbetur deri në datën e skadencës. Nëse merr diçka me afat më të shkurtër, trajtohet si produkt me të meta.

## Kontakti

info@biocode.fit — përgjigjemi brenda dy ditëve të punës.
$md$, 'en', $md$
## Where we deliver

We deliver anywhere in Kosovo. We do not ship abroad at present.

## Methods and prices

| Method | Price | Time |
| --- | --- | --- |
| Standard | €2.00 | 1–3 working days |
| Express Prishtina | €4.00 | same day, Prishtina only |

**Standard delivery is free on orders over €30.00.** The threshold is calculated on the value of the products after any discount.

The delivery price is shown at checkout before you confirm the order. There are no hidden costs.

## When orders go out

Orders confirmed before 14:00 on a working day are prepared the same day. Orders placed on Saturday, Sunday or a public holiday are prepared on the next working day.

The times above are working days and start when the parcel is handed to the courier, not when the order is placed.

## Payment

Payment is **cash on delivery**, to the courier. Check the parcel before you pay.

## If the parcel does not arrive

The courier attempts delivery and contacts you on the number you left. If they cannot reach you, the parcel returns to us and we notify you by email.

If your order has not arrived within the stated time, write to info@biocode.fit with your order number and we will chase it with the courier.

## Right of withdrawal — 14 days

You have the right to cancel your order within **14 days** of receiving it, without giving any reason. This is your legal right as a consumer in a distance sale.

To exercise it, write to info@biocode.fit within that period with your order number and the items you wish to return. You then have a further 14 days to send the product back.

### What can be returned

The product must be **unopened, with the original seal intact.**

Food supplements are sealed hygiene products. Under the law, the right of withdrawal does not apply to such goods once the seal has been removed after delivery — because once opened they cannot be returned to sale. This does not affect any of your rights where a product is faulty.

### Refunds

We refund the amount paid for the products within **14 days** of receiving the parcel back and checking it. The original delivery cost is also refunded if you cancel the whole order.

The cost of returning the product is yours, except where the product is faulty or the wrong item was sent.

## Faulty or incorrect products

If you receive something damaged, expired, or different from what you ordered, write to us **within 48 hours** of delivery with your order number and a photograph.

In those cases we replace the product or refund the full amount including delivery, and the return cost is ours. This applies whether or not the seal has been removed.

## Expiry dates

Every product we ship has at least **six months** remaining before its expiry date. If you receive something with less, it is treated as a faulty product.

## Contact

info@biocode.fit — we reply within two working days.
$md$)
where slug = 'shipping-returns' and body->>'sq' like '[LEGAL: review]%';
