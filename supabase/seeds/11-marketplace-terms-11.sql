-- =============================================================================
-- Seed 11 — marketplace terms 1.1: images and content the merchant supplies
--
-- ── Why a version bump and not an edit ──
--
-- Merchants may now upload product photographs with a proposal, and an approved proposal carries them
-- onto a BioCode product page. That is BioCode publishing somebody else's photograph, and version 1.0
-- said nothing about it — no warranty that the merchant holds the rights, no licence to use the image,
-- no indemnity if it turns out to belong to a manufacturer who objects.
--
-- Clause 13 promises **30 days' notice** for any change, and the version a merchant accepted is stored on
-- its row. So this is a new version rather than a silent edit: the record of what each merchant agreed to
-- has to stay true.
--
-- **No merchant has accepted 1.1, and nothing forces them to.** `hasCurrentTerms()` compares against the
-- constant and there is no re-acceptance prompt (docs/14 §19). Moot right now — no real merchant exists —
-- and the demo rows still say 1.0, which is honest. Re-acceptance is the v2 item the 30-day notice hangs
-- off.
--
-- ── Appended, not replaced ──
--
-- The first draft of this file was an `update … set body = <clause 14>`, which would have published a
-- terms page consisting of clause 14 and nothing else. Clauses 1–13 are 1,340 words per locale and live
-- in seed 09; restating them here would be two copies of a legal document free to diverge.
--
-- So this **appends** to the stored markdown and rewrites the version line in place. Idempotent by the
-- `not like '%1.1%'` guard: running it twice does not append clause 14 twice.
--
-- Still written by engineering, still not a substitute for review by somebody qualified in Kosovo
-- commercial and IP law. The new clause is the one most worth a lawyer's eye.
-- =============================================================================

update pages
   set body = jsonb_build_object(
         'sq',
         replace(body->>'sq', '**Versioni 1.0**', '**Versioni 1.1**') || $md$

## 14. Fotografitë dhe përmbajtja që dërgon Shitësi

Kur Shitësi ngarkon fotografi, tekst ose çdo material tjetër — përfshirë propozimet për produkte të reja —
Shitësi **garanton** që:

1. i posedon të drejtat e autorit, ose ka leje të shprehur nga poseduesi për ta përdorur materialin në një
   dyqan online tregtar;
2. materiali nuk shkel të drejtat e markës, të dizajnit ose të privatësisë së asnjë pale të tretë;
3. fotografia i përgjigjet produktit real që dërgohet — paketimi, sasia dhe forma.

Shitësi i jep BioCode-it një **licencë joekskluzive, pa pagesë dhe të transferueshme** për ta përdorur
këtë material në faqet e produktit, në rezultatet e kërkimit, në email dhe në reklamat e dyqanit, për sa
kohë që produkti listohet.

BioCode mund ta heqë çdo material në çdo kohë, pa arsyetim. Nëse një palë e tretë pretendon shkelje,
BioCode e heq materialin menjëherë dhe Shitësi mbulon çdo dëm, gjobë ose kosto ligjore që rrjedh nga
pretendimi.

Materiali i ngarkuar mbetet privat derisa propozimi miratohet. Miratimi nuk e detyron BioCode-in t'i
publikojë fotografitë.

## 15. Ndryshimet ndaj versionit 1.0

Shtohet klauzola 14. Pjesa tjetër e kushteve nuk ndryshon.
$md$,
         'en',
         replace(body->>'en', '**Version 1.0**', '**Version 1.1**') || $md$

## 14. Images and content the Seller supplies

When the Seller uploads photographs, text or any other material — including product proposals — the
Seller **warrants** that:

1. it owns the copyright, or has the express permission of the owner to use the material in a commercial
   online shop;
2. the material infringes no third party's trade mark, design or privacy rights;
3. the photograph depicts the actual product that will be shipped — its packaging, count and form.

The Seller grants BioCode a **non-exclusive, royalty-free, transferable licence** to use that material on
product pages, in search results, in email and in shop advertising, for as long as the product is listed.

BioCode may remove any material at any time, without reason. If a third party alleges infringement,
BioCode removes the material immediately and the Seller covers any damages, fines or legal costs arising
from the claim.

Uploaded material stays private until the proposal is approved. Approval does not oblige BioCode to
publish the photographs.

## 15. Changes from version 1.0

Clause 14 is added. Nothing else in the terms changes.
$md$
       ),
       updated_at = now()
 where slug = 'marketplace-terms'
   -- Idempotent: a second run finds clause 14 already there and changes nothing.
   and body->>'en' not like '%14. Images and content the Seller supplies%';
