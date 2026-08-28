# 16 · MERCHANT MARKETPLACE (M12)

BioCode becomes a **hybrid marketplace**: it sells its own stock and approved third-party merchants
sell theirs on the same storefront, through a self-service portal. BioCode stock always wins
fulfilment; merchant orders are routed by admin decision. Merchants are strictly siloed — they see
only their own products, their own orders, their own money.

This document records the shape of the thing and the decisions taken while building it.

---

## 1 · Core model — canonical products, merchant offers

`products` stays the **admin-owned catalogue**: one page, one PDP, one review pool, one SEO URL.
A merchant adds a row to `merchant_offers` — "I have variant V at price P with stock S".

That is not a tidiness preference. _"Route this order to a merchant who has the same stock"_ is only
a computable question when BioCode and every merchant point at **one variant id**. Let merchants
create their own listings and the same tub of vitamin D becomes three products, three review pools,
three URLs competing in search, and no way to ask who else has it.

BioCode's own stock stays in `inventory_levels` and is **not** an offer row. First-party is
privileged by the shape of the schema rather than by a flag somebody has to remember to check.

A merchant wanting a product that does not exist submits a **proposal** (§4); admin approves and
creates the canonical product, and the merchant gets an offer on it.

**Buy box:** BioCode stock, if any, always wins. Otherwise the cheapest in-stock approved offer from
an active merchant, tie-broken by merchant rating then oldest offer.

---

## 2 · Data model

Migrations 25–28. Eight new tables, five enums, one extra order status, two columns on
`order_items`.

| Table                | Holds                                                          |
| -------------------- | -------------------------------------------------------------- |
| `merchants`          | Identity, ARBK number, bank, commission, status, terms version |
| `merchant_users`     | Which profiles act for which merchant                          |
| `merchant_documents` | KYB uploads; `storage_path` into a **private** bucket          |
| `merchant_offers`    | One per (merchant, variant): price, stock, handling, status    |
| `product_proposals`  | A merchant asking for a new canonical product                  |
| `order_fulfilments`  | An order splits into one row per fulfiller                     |
| `merchant_ledger`    | Append-only, **signed**: `+` owed to the merchant, `−` by it   |
| `merchant_payouts`   | Per-cycle statements                                           |

Three schema decisions worth their own line:

- **The ledger is one signed column**, not debit/credit. COD runs both ways: normally BioCode's
  courier collects the cash and owes the merchant its net, but a merchant with its own courier
  collects and owes BioCode the commission. One signed column expresses both, and the balance is
  just the sum. No update or delete policy exists anywhere — a correction is another row, the same
  discipline as `stock_movements` (docs/13 §A7).
- **`fulfilment_merchant_iff_merchant_kind`** — `(fulfiller_kind = 'merchant') = (merchant_id is not
null)`, both directions. It is what stops a BioCode fulfilment quietly carrying a merchant id that
  a later query would believe.
- **`order_items.fulfilment_id` is permanently nullable.** Every order placed before M12 has none,
  and back-filling would invent a fulfilment that never happened. Null reads as "pre-marketplace,
  BioCode fulfilled it", which is true.

### The enum trap

`alter type … add value` **cannot be used in the transaction that added it.** Supabase runs each
migration file as one transaction, so a file that adds `merchant` to `user_role` and then writes a
policy naming `'merchant'::user_role` fails on its last statement having looked fine in review.
Hence migration 25 does exactly one thing.

`is_staff()` is deliberately **not** extended. It enumerates who may see `/admin`, and most staff
policies read `using (is_staff())` — adding `merchant` there would hand every merchant the
catalogue, the order queue and the audit log in one line.

---

## 3 · Isolation — the security core

Three layers, and the third is the one that lasts:

1. **RLS on every table**, filtered through `current_merchant_ids()` — a security-definer function,
   because a policy on `merchant_offers` that queried `merchant_users` directly would need a policy
   on `merchant_users` that needed to know the same thing. It returns `{}` for anonymous users,
   customers and staff, so "not a merchant" produces zero rows rather than an error.
   **A suspended merchant is excluded inside the helper**, so suspension applies everywhere at once
   rather than in each policy separately.
2. **Privileged columns unreachable.** Postgres has no per-column policy — `with check` says which
   _rows_ may be written, never which _columns_ — so `status`, `commission_pct`, offer approval,
   fulfilment money and the merchant lane are frozen by triggers. Without them `p_own_update` on
   `merchants` is a self-approval button.
3. **One read path into order data.** `merchant_fulfilment_view(fulfilment_id)`, security definer,
   returning a **fixed jsonb shape**. Merchants are never granted select on `orders` at all — not a
   narrow policy, none — so there is no join for a future feature to reach through, and no column
   allowlist for anyone to forget to maintain.

The view withholds the **address and phone until the fulfilment is assigned**: before that the
merchant is one of several candidates on the routing screen and only one will ever ship it. It
returns _this fulfilment's_ subtotal as the COD amount, never the order total.

`is_cod` reads from `payments`, not from `orders` — the provider lives on the payment, because a
failed card attempt followed by cash on delivery is two rows and one order.

### The suite is the gate

`tests/integration/marketplace-isolation.test.ts` — **42 cases**, written as an attacker would:
merchant A signed in, holding merchant B's row ids, asking directly. Empty or refused, every time.

It asserts in **both directions**, which is what stops it passing vacuously: A _can_ read its own
offers, _can_ move `assigned → accepted`, _can_ update its own contact details, and staff _can_ read
across merchants. If the policies merely denied everything, half the file would fail.

Covered: no read path to `orders` at all; a BioCode fulfilment invisible to every merchant; only own
`order_items`; no `inventory_levels`; cannot self-approve; cannot approve an offer; cannot write a
ledger row; cannot mark a payout paid; cannot mark a fulfilment `delivered` (that would trigger its
own payout); cannot skip its lane; a bank change is allowed and **writes an audit row**; and the view
never contains the email, the total, a coupon or loyalty — asserted by searching the serialised
payload rather than by naming keys, so it still holds when somebody adds a field.

---

## 4 · Onboarding — done

- `merchant` added to `USER_ROLES`, and `STAFF_ROLES` rewritten as an **explicit non-staff list**.
  It used to be `USER_ROLES.filter(r => r !== 'customer')`, so adding the role would silently have
  made every merchant staff and opened `/admin` — the same trap as `is_staff()` in SQL, one layer up.
- Five marketplace capabilities. `merchants.manage` and `payouts.manage` are admin-only: approving a
  merchant sets a commission and a shipping arrangement, which is a commercial decision.
- Middleware protects `/merchant/**` with `/merchant/apply` exempted by exact match.
- A merchant reaching `/admin` gets **404**, not a redirect — a redirect confirms the surface exists
  behind an authorisation check. Customers still get the redirect; they arrive by mistyping.
- **Route collision resolved.** §5 puts the portal at `/merchant/**` and §9 the public seller page at
  `/merchant/[slug]`; those cannot both resolve. The portal keeps fixed segments and the public page
  moves to `/seller/[slug]`, so no dynamic segment ever sits beside a portal route.

### The flow

`/merchant/apply` (public, indexed, rate-limited 3/h per IP) → `merchants` row at `pending` +
`merchant_users` membership + role `merchant` → applicant invited by email → uploads documents in the
portal → `/admin/merchants/applications` → approve, request info, or reject.

**Documents are uploaded after submission, and that ordering is forced rather than chosen.** The
storage policy scopes writes to `merchants/<merchant_id>/`, which cannot exist before the merchant
row does. The brief asks for the form to save drafts; an applicant has no account, so a draft would
be either browser-local (lost on their other device) or a half-populated `merchants` row with no
owner that the admin queue would have to learn to ignore. So the fields are grouped as the steps
would have been and submitted once.

### Decisions inside it

- **Commission and shipping are set at approval**, as required inputs on the approve form. A merchant
  going live on a commission nobody chose is a commercial decision made by a column default, first
  noticed on a statement.
- **Terms acceptance is recorded at submission**, not approval: the applicant accepted that version
  on that date, and an admin approving them later does not change what they agreed to.
- **`z.literal('on')` for both checkboxes.** An unchecked box is absent from the FormData, and
  `z.coerce.boolean()` would turn `undefined` into `false` and pass — recording an acceptance that
  never happened. Asserted in the suite.
- **The slug is generated, never chosen.** A merchant picking its own slug is picking part of
  BioCode's URL namespace; the first `biocode-official` attempt is a conversation nobody wants.
- **IBAN is shown to reviewers as the last four digits only.** A review screen gets screenshotted.
- **`request info` is not a status.** It writes the reviewer note and leaves the row `pending`, rather
  than adding a fourth `merchant_status` value to handle everywhere for what is really a note.
- **KYB documents have no update or delete policy for anyone.** A document is evidence of who somebody
  claimed to be when they were approved; replacing one in place would leave the row pointing at
  different bytes than the reviewer verified. A correction is a new upload.
- **Documents open through a route handler that signs on click**, five-minute expiry. Signing at
  render would mint URLs for documents nobody opens, sitting in the HTML of a page left open.

### Tests

`tests/integration/merchant-onboarding.test.ts` — 15 cases. The schema half (terms unchecked is
refused, IBAN normalised, diacritics survive slugging) and the transition half (approval records the
terms; `merchant_settlement` then returns 12.5% of €10 as €1.25 with €2.00 shipping and €6.75 due;
approving twice does not move the terms; a **rejected** merchant loses access entirely while a
**pending** one can still see its own application).

The actions themselves are not unit-tested: they are `'use server'` modules reading `headers()` and
`revalidatePath()`, neither of which exists outside a request. The click-through is step 9's job.

Still to build: the portal shell itself (step 3), so an invited merchant currently has an account and
nowhere to go but `/merchant/apply`.

---

## 8 · Money — settled decisions

### Commission

Set **per merchant** during review of the application and stored on `merchants.commission_pct`.
Calculated on the **item subtotal**, never on shipping — a merchant shipping its own parcels would
otherwise pay commission on postage.

> €10.00 item at 10% → BioCode retains €1.00, the merchant receives €9.00.

Verified against the live function: 1000c at 10% returns `commission 100 / due 900`, and 999c returns
`100 / 899` — the two summing back to the subtotal, so no cent is created or lost by rounding.

### Shipping cost — three options, per merchant

`merchants.shipping_borne_by`, with `null` meaning the marketplace default in
`settings.marketplace.shipping_borne_by`. Per-merchant because it is negotiated exactly as the
commission is; a single global switch would treat the merchant who agreed to absorb shipping and the
one who did not identically.

| Option     | Ledger effect                      | Merchant due                     |
| ---------- | ---------------------------------- | -------------------------------- |
| `biocode`  | none                               | subtotal − commission            |
| `merchant` | a `shipping` row for −cost         | subtotal − commission − shipping |
| `customer` | none, recorded as customer-covered | subtotal − commission            |

**`customer` does not add a checkout surcharge, and cannot in v1.** The customer is charged one
shipping fee before routing happens — admin picks the merchant _after_ the order exists (§6) — so
there is no per-merchant shipping line to add at the moment money is taken. Charging one would mean
routing before checkout or a second charge afterwards. `customer` therefore means "covered by the
delivery fee already collected", and is a distinct value from `biocode` for attribution rather than
for arithmetic.

`merchant_settlement(merchant_id, subtotal_cents)` is the only place this arithmetic lives, and it
returns the three numbers together because they must agree: `due = subtotal − commission − shipping`.
Computing them in separate places is how a statement stops reconciling.

### Terms

Written and live at `/legal/marketplace-terms`, ~1,340 words per locale, version `1.0` in
`src/features/merchants/terms.ts`. Thirteen clauses covering the party structure (the sale is
BioCode↔customer; the merchant is a supplier, which is _why_ it never contacts the customer),
the canonical-catalogue rule, authenticity and lawful import, prohibited health claims, commission
with the worked example, all three shipping options, COD in both directions, the fortnightly cycle
with a 14-day dispute window, the 24-hour acceptance SLA, return liability split by cause, the
merchant's position as a **processor** purpose-limited to fulfilment, suspension grounds, and 30
days' notice on any change.

Two things to know about it:

- **Written by engineering, not by a lawyer.** Accurate about what the software does, and not a
  substitute for review by someone qualified in Kosovo commercial and data protection law. The
  trader identification block carries `[BIZNESI: plotëso]`.
- **Clause 5 names the prohibited verbs**, so a claim-lint over `pages` will flag this page. That is
  correct: a document that prohibits "cures, treats, prevents or heals" has to be able to say them.
  Do not "fix" it by making the prohibition vague.

---

## 5 · Portal, offers and the buy box — done

### The pricing decision everything else follows from

**The canonical variant price is the only customer-facing price.** A merchant offer is _supply_, not a
listing: `merchant_offers.price_cents` is what the merchant asks BioCode for the unit, and it never
reaches the storefront. One product, one page, one price, whoever happens to hold the stock.

The alternative — the winning offer prices the line — was considered and rejected, because routing
happens **after** the order exists (§6). The merchant who priced it need not be the merchant who ships
it, so the customer would have paid a price belonging to a supplier who never touched the parcel. It
would also have made the PLP and the PDP disagree the moment BioCode ran out of something.

What the asking price is _for_, then, is real and specific: it sorts the buy box, and it is the number
a reviewer weighs against what settlement would pay.

### `variant_buy_box(uuid[])`

Security-definer, anon-executable, one row per variant asked for. BioCode stock wins; otherwise the
cheapest approved in-stock offer from an approved merchant, tie-broken by merchant rating and then by
the oldest offer — every term deterministic, so two calls a second apart cannot name different sellers
on an unchanged page.

It returns **bucketed stock and no prices at all**. It reads `inventory_levels` (staff-only) and
`merchant_offers` (merchant-scoped), so it is a window rather than a door, and the reasoning that
bucketed `v_product_stock` in docs/13 §B7 applies twice over here: a per-merchant unit count would let
a competitor sit on the endpoint and infer both parties' sales velocity.

### `v_merchant_offer_detail`

One view, `security_invoker = on`, serving both audiences: a merchant sees its own offers and staff see
every merchant's, because RLS runs as the caller. Two near-identical queries would drift, and the
column that drifted would be `merchant_due_cents` — the one a merchant would notice on a statement.

`merchant_due_cents` is computed from the **retail** price, not the asking price, because that is what
settlement actually pays. Showing a merchant that number beside its own asking price is the
transparency the terms promise; for a reviewer it is the signal that decides the offer.

### What is on the storefront, and what is not

The PDP names the seller: "Sold and shipped by BioCode", or the merchant when a merchant supplies it.
On a hybrid marketplace that is a disclosure, not decoration — the sale is always BioCode↔customer and
the merchant is a supplier (terms, clause 1), and a shopper who cannot tell who is behind a listing
cannot tell who to hold to a promise about it.

**Merchant supply is not purchasable yet, and that is deliberate.** `checkout_create_order` requires
BioCode `inventory_levels` stock and decrements it, so a merchant-only variant still renders as out of
stock. Making it buyable belongs with step 4, where the order can actually be routed, accepted and
shipped — an order nobody can fulfil is worse for the customer than a product marked out of stock. The
seller line therefore renders only on a variant that can be bought, so nothing on the page is a claim
the system cannot honour. The E2E suite asserts the out-of-stock case explicitly, so the day this
changes, the test changes with it on purpose rather than by accident.

### The portal

`/merchant` is a sibling of `/account`, not part of the storefront group: it takes the navbar and
footer, and none of the wishlist, compare, consent and bottom-stack machinery a shopper needs.
`/merchant/apply` stays in the storefront group with the full chrome, which is why a route group and a
plain segment share the name `merchant` — the resolved paths never collide.

It is **bilingual**, unlike `/admin`. Admin is English-only because BioCode staffs it; a merchant is a
Kosovo business that did not choose BioCode's internal language.

Screens: a dashboard (what needs doing, the numbers, your terms), offers with status filters, an offer
form, documents, and settings. Three decisions worth keeping:

- **Buy-box wins are on the dashboard**, computed from `variant_buy_box`. "Approved" is not the same as
  "selling" — an approved, in-stock offer still loses to BioCode's stock and to a cheaper rival — so a
  portal that showed only the status would let a merchant believe it was live for weeks.
- **Two fields are editable inline**: stock, which is the daily edit, and pause/resume, which is what a
  merchant reaches for when they sell the last one at the counter. A table where six fields are
  editable is a table where somebody changes a price by mistake.
- **The IBAN is never prefilled**, even for the merchant. The portal holds only the last four digits, so
  an empty field that means "unchanged" is the only version that cannot be saved back over a real payout
  destination by somebody fixing a phone number.

The offer actions are thin on purpose: they validate, name the merchant, and let the database enforce
the rest through the SSR client on the merchant's own session. **No service client appears anywhere in
the portal**, and none should — a service-role write would step over exactly the guard that makes "a
merchant cannot approve its own offer" true.

### Documents

The upload finally lands here, and it is two steps: the **browser** puts the file in Storage, then a
server action records the row. A server action's body is capped at 1 MB by default and a scanned
registration certificate is routinely 3–5 MB, so posting the bytes through an action would reject
precisely the documents the screen exists to collect. The path is therefore **verified, not trusted** —
the action refuses anything outside `merchants/<own-id>/`.

The Supabase browser client is imported inside the click handler. A static import put 80 kB in that
page's first load and `pnpm check:bundle` failed at 215 kB against a 170 kB budget; it is 133 kB now.

### Admin

`/admin/merchants/offers`, behind `offers.review` rather than `merchants.manage`. Approving a _merchant_
sets a commission and a shipping arrangement, which is commercial and admin-only; approving an _offer_
is a judgement about whether a third party may sell against a BioCode product page, which belongs to
whoever owns the catalogue.

The screen shows retail, what settlement pays, what the merchant asks, and the gap. When asking exceeds
due, every unit routed there costs BioCode the difference — flagged in cents, not left for a reviewer
to work out.

### Tests

- **19 integration** on the buy box: BioCode beats a cheaper offer; cheapest wins; ties break by rating
  then by age, twice in a row; draft, pending, paused, zero-stock and suspended-merchant offers all stay
  out; and the payload carries no unit count and no price, asserted both by searching the serialised row
  for distinctive quantities and by checking the key names.
- **24 integration** on the offer lifecycle, every write through the merchant's own session: it can
  create, edit, submit, pause, resume and delete a draft, and cannot approve, reject, drop an approved
  offer to draft, delete an approved one, or touch a rival's. Both shapes of refusal are asserted
  separately — the trigger _errors_, a policy matches _zero rows and no error_.
- **22 unit** on the schemas: euro to cents, a comma decimal separator, rounding rather than truncation,
  and the finite check that `Number('')` would otherwise slip through.
- **26 E2E** on both viewports, driving the offer through the screens: create it, approve it as a
  product manager in a second session, then confirm the merchant's own portal says it is in the buy box.
  Plus the boundary — a merchant gets 404 at `/admin` — and the seller line in both locales.

Not covered by a test, and worth stating: no component-render unit tests exist in this project, so
`SellerLine` is asserted only through E2E.

---

## 6 · Routing — merchant supply becomes purchasable

### Checkout sources a line

BioCode first, always: a variant BioCode can ship never reaches a merchant however cheap the offer.
Otherwise the buy-box winner, resolved **in SQL with `for update` on the offer** and its stock reserved
there and then.

The reservation happens at checkout rather than at routing, and the oversell test is why: routing is an
admin decision taken after the order exists, so taking stock at assignment means two customers buying the
last unit both succeed and the merchant declines one of them a day later.

A line BioCode cannot fully cover goes **entirely** to a merchant. Splitting one line across two
suppliers means two parcels for one product and neither side shipping what its screen said.

Pricing is untouched. The line is priced from `product_variants` whoever supplies it (§5).

### `route_order`, `assign_fulfilment`, `release_fulfilment`

`route_order` splits an order into one fulfilment per fulfiller, idempotently. BioCode's is created
`assigned` — there is nobody to ask — and a merchant's `unassigned`, naming the merchant whose stock
checkout reserved: **the buy box proposes, the admin decides.**

`assign_fulfilment` is not a status update. It moves the stock reservation between merchants and
recomputes commission atomically, and its loop asks per line "is this already reserved from the merchant
we are assigning to?" — which is what makes reassign-after-decline-to-the-same-merchant correct. An
earlier version keyed on `merchant_id` changing and silently left those lines with no reservation at all.

`release_fulfilment` returns the reservation, because a merchant that ships nothing keeps its stock.

`fulfilment_candidates` lists merchants that can cover **every** line — a merchant with two of three
products is not a candidate, because splitting a fulfilment further means two parcels for lines the
customer bought together.

### Auto-routing

Built, and switched off. `auto_route` is `false` and stays false: the scorecard it picks candidates by
needs weeks of real fulfilments before its numbers mean anything, and manual routing is where an operator
learns which merchants actually answer.

When on it assigns each unassigned fulfilment to the first row `fulfilment_candidates` returns — the same
list, same order, a human sees — through `assign_fulfilment`. It will not escalate, will not split a
fulfilment to make itself succeed, and will not override a human. It reports `enabled: false` rather than
doing nothing quietly.

---

## 7 · The merchant's lane, partial shipments, and the emails

`assigned → accepted → packed → shipped`, plus declining before acceptance. **`delivered` is BioCode's
word**, refused from a merchant by the transition guard, because a merchant that could mark its own
parcels delivered could trigger its own payout. Timestamps are stamped by a trigger so an SLA cannot be
backdated.

`partially_shipped` was added to the enum in migration 28 and had been **unreachable** ever since,
because no transition admitted it. Order status is now derived from its fulfilments: two shippers who do
not know about each other cannot each decide what the order is.

### Emails

Ten merchant templates plus the partial-shipment notice. The rule that shapes all of them: **merchants
never receive the customer's email and never message customers**. A merchant email says what the merchant
has to do and links into the portal, which is behind a session.

The partial-shipment notice needed its own template because `templateForStatus` maps one order to one
status and neither "shipped" nor silence is true of a half-shipped order — a customer who receives one
box of two assumes something went missing, which becomes a ticket and then a chargeback. It does **not**
say who is shipping which part: the sale is BioCode↔customer, and the seller line on the product page is
a disclosure before buying, not logistics after.

Reminders and the notice are cron sweeps rather than calls from the shipping action, because the
transition is made by a database trigger fired by whichever party shipped and there is no one path to
hang them on.

---

## 8 · Money — the ledger and the payouts

**A merchant is owed on delivery**, not on shipping (a parcel in transit can come back) and not on
payment (a COD order is not paid until the courier hands the cash over).

Three or four rows per delivered fulfilment — `sale`, `commission`, `shipping` when the merchant bears
it, `cod_collected` when the merchant took the cash — rather than one net row, so a merchant asking why
it is owed €8.50 on a €10 sale gets an answer. Idempotent on `(fulfilment, kind)` by unique index rather
than by checking first, because two concurrent callers both pass a check.

Refunds claw back proportionally by reversing the whole fulfilment × the refunded fraction, so a full
refund lands on zero rather than leaving a rounding residue.

### The invariant

`amount_cents` is signed and the balance is a plain `sum` over **every** row including payouts. Building
a payout posts its own balancing negative row, so after building, the balance has dropped by exactly what
the statement says — with no "these rows are spoken for" state anywhere. Building twice settles nothing
the second time, which is what makes a daily cron safe; marking one _paid_ posts nothing, because the
money left the balance when it was _built_.

The cycle is **calendar halves** (1st–15th, 16th–end), not a rolling fortnight that drifts until
statements straddle month ends. `payout-period.ts` is pure and takes the date, so the boundary is
testable.

No update or delete policy exists on the ledger for anyone, including admin. A correction is another row.

---

## 9 · Proposals, bulk updates and the scorecard

**A proposal is an argument.** It carries what the merchant knows — name, brand, form, barcode, a link to
the manufacturer, the stock it holds, what it would ask — and **photographs of the box**. BioCode decides.

### What approving does, and the line it does not cross

Approving records the decision **and creates a draft product** carrying the merchant's photographs, name,
brand and form (`promote_proposal_to_draft` + `promoteProposal`).

This reverses the first shape of this section, which said approving creates no product on the reasoning
that anything else was merchant-created listings with a delay. Two facts moved the line:

- **`created_product_id` has existed on `product_proposals` since the M12 migration** and was wired to
  nothing. The schema always anticipated the link.
- **A draft cannot reach a customer.** `search_products`, `listProducts` and `getProduct` all read through
  the anon client, whose RLS policy on `products` is `status = 'published'`, and publishing needs
  `compliance.approve` — which neither the merchant nor the product manager approving the proposal holds.

So the honest reading of "an approved photograph appears on the site" is: it appears the moment the
product is published, and nobody's photograph reaches a customer without a compliance officer having
looked. What a proposal produces is a head start for the catalogue team — the price is written as the
merchant's asking price and flagged provisional, and the copy, the ingredients, the warnings and the
compliance pass are all still ahead of it.

**Why images are the one thing the merchant may supply.** The form still refuses to ask for a description
or ingredients: those are the listing, and asking a merchant to draft them is asking it to write one. A
photograph is different — the merchant is holding the box, and it is the only party that can photograph
it. Clause 14 of the terms (version `1.1`) makes it warrant that it holds the rights and that the images
depict the real product, which is a promise rather than a guarantee, so the review screen shows the
photographs and says plainly that approving publishes them.

### The mechanics worth knowing

- **The bytes go from the browser**, to a **private** `merchant-proposals` bucket under
  `proposals/<merchant_id>/`, before the proposal row exists — the merchant id is known while the form is
  still being filled. A server action's body is capped at 1 MB and a phone photograph is routinely larger,
  so posting six through an action would reject exactly the uploads this exists to collect. Six images,
  2 MB each, four formats; the client mirrors the bucket's limits so nothing accepted here is refused there.
- **The paths are verified, not trusted.** `submitProposal` reads them with `getAll` (`Object.fromEntries`
  keeps only the last of a repeated key, so the Zod schema cannot see them at all) and refuses any path
  outside this merchant's own folder. The storage policy already stops the _upload_; nothing stops a
  crafted submission naming somebody else's object, and approval copies images onto a public page.
- **The reviewer sees them through `/admin/merchants/proposal-image`**, which re-checks `offers.review`,
  constrains the path to the `proposals/` prefix, and redirects to a 5-minute signed URL. Signing every
  image at render time would mint URLs for photographs nobody opens, each valid for its whole expiry in
  the HTML of a queue left open all afternoon.
- **Promotion copies rather than moves.** `products/<product_id>/…` is exactly where the product editor
  puts its own uploads, so an image that arrived this way is indistinguishable from one a product manager
  added — a reviewer reordering them should not have to know. The original stays in the private bucket as
  the merchant's evidence of what it proposed.
- **Image failures are counted, not thrown.** A draft whose third photograph did not copy is something a
  reviewer fixes in the editor; a throw would leave the approval half-applied. For the same reason, a
  failed promotion does **not** fail the approval — the decision is recorded and the merchant is told.
- **Promotion is idempotent** (`created_product_id is not null` returns early), so a stale tab cannot mint
  a second product.
- **The form is taken only when it names a `product_form` member**, matched case-insensitively and loosely
  singularised. The field is free text on purpose — a merchant knows forms BioCode does not — so a bare
  cast would throw on a valid proposal. See docs/13 §X11.

---

## 9.1 · Pasted catalogues — a batch is one thing a reviewer decides

A merchant onboarding two hundred products BioCode does not list had to submit two hundred proposals, one
form at a time, against a cap of twenty open ones. The honest answer was "we cannot take your catalogue".

**The cap is not the problem to remove.** It exists because one merchant must not be able to make the review
queue unusable for everybody else. What changes is _what a reviewer decides_: a **batch** is one queue item
with many rows. The merchant pastes a sheet, the reviewer reads a table, rejects the rows that are wrong, and
approves the rest in one action.

### The caps, and why they moved

| Path                 | Limit                    |
| -------------------- | ------------------------ |
| Individual proposals | 20 open — unchanged      |
| Batch rows           | **exempt** from that cap |
| A batch              | 200 rows                 |
| Open batches         | 3 per merchant           |

Batch rows are exempt because the queue cost of a batch is one table a reviewer scrolls, not 200 cards — so
the thing being limited is the thing that actually costs review time. Counting them in the twenty as well
would mean a merchant that pasted its catalogue could no longer propose the one product it thought of
afterwards, which is the opposite of what either limit is for. `listProposals` and `proposalCounts` filter
`batch_id is null` for the same reason: 200 cards from one paste would bury every individually-argued
proposal underneath them.

### Reject per row, approve the batch

The asymmetry is the design. **Rejecting is a judgement about one product** — wrong brand, no barcode, we
already list it — and each rejected row needs its own reason the merchant can act on, so each row has its own
form. **Approving is a judgement about the sheet**, so `decide_proposal_batch` takes every row still pending
and leaves rows already rejected exactly as they are.

A batch whose every row was refused at parse time **leaves no batch behind**. Otherwise a merchant fixing its
spreadsheet burns one of its three slots per attempt and the reviewer's queue fills with empty tables.

### Photographs keyed by filename

The rows arrive without images: a server action's body is capped at 1 MB and three hundred phone photographs
are not going through it. So the bytes go from the browser to the private `merchant-proposals` bucket, and
**the filename says which row they belong to**.

- The key is the **barcode**, else the merchant's own **SKU**, normalised hard — lower-cased and stripped of
  everything that is not a letter or a digit, because the same code is written `5099-9999`, `5099 9999` and
  `5099_9999` by three different people, and a photograph that did not attach because of a hyphen is
  indistinguishable from a bug.
- `8712345678901-2.jpg` is the second photograph of one product, so a **trailing counter of one to three
  digits** comes off. The whole stem is tried first, in case a SKU genuinely ends in `-2`. Four digits are
  left alone: trimming them would turn every `IMG_4821.JPG` into the key `img`.
- Anything unmatched appears in an **assign list** with a select per file. That is the same dropdown as the
  naive design, except only for the files that need it — usually a handful rather than all three hundred.

The alternative was a dropdown per photograph, which for a real catalogue is three hundred dropdowns and
nobody does it.

**Attaching goes through `merchant_attach_batch_images`, not an UPDATE.** `p_own_update` admits a merchant
only for `status = 'needs_info'` — a pending proposal must not change under the reviewer reading it — so a
direct write matched zero rows, and PostgREST calls that success (docs/13 §X15). The function permits exactly
one change, appending paths, re-checks the folder prefix and the row's batch, and **returns what it actually
wrote**. Uploading closes when the batch is decided, because promotion has already copied the images.

### Promotion at scale

Approving 200 rows means 200 draft products and every photograph copied between storage buckets — many
hundreds of round trips, well past what a request should hold open. So:

1. `decide_proposal_batch` records the decision for every row and **creates nothing**;
2. `decideBatch` promotes a bounded first slice (5) inline, so the reviewer sees it work;
3. the housekeeping cron drains `proposals_awaiting_promotion` at **15 a night**.

The queue is a **view** — `status = 'approved' and created_product_id is null` — not a column. A row leaves
by being _done_ rather than by being marked, which makes overlapping drains harmless: two sweeps racing on
one row both call an idempotent function and the second gets `created: false`. There is no "claimed" flag to
leak when a run dies halfway.

Both numbers come from measurement, not taste. One row with one photograph takes about a second — an RPC, a
download from the private bucket, an upload to the public one, an insert — and a row may carry six images.
So **five inline** is a worst case of roughly twenty seconds, inside the sixty the admin batch page declares
via `maxDuration` and inside Vercel's default even if that declaration is ever lost; **fifteen a night** is a
worst case of about a minute against a cron budget of sixty seconds shared with eight other steps, all of
which have already committed their work by the time the sweep runs.

The failure mode each bound avoids is different. A request that dies at the platform's timeout _after_
`decide_proposal_batch` has committed every decision reads as a broken feature even though nothing was lost.
A cron that overruns loses only its summary — but a timeout logged every night is a signal nobody reads after
the first week.

The products are drafts either way, invisible until compliance publishes them, so a queue that takes days to
drain costs nothing. The awaiting count is shown on the admin proposals screen, so a queue that is not
draining **at all** is visible rather than silent.

**The images land at `<product_id>/<file>`** — the same path `media-actions.ts` signs for an editor upload.
The first version wrote `products/<product_id>/…` and claimed in a comment that this matched the editor; it
did not, and one bucket with two conventions is one where every future sweep is right about half the objects
(docs/13 §X16).

**Bulk update is a paste, not an upload** — the real workflow is "open the spreadsheet, select the
columns, copy". The export sits above the paste box so a merchant editing the sheet it was given has the
right SKUs by construction. The parser handles semicolons (Excel in a comma-decimal locale, which Kosovo
is), comma decimals, tabs, a BOM, CRLF, quoted fields and bilingual header aliases — and **refuses** a
sheet with no recognisable header rather than guessing column order, because guessing writes prices into
stock levels silently.

## 6.1 · Bulk offer _creation_

The same paste box also **creates** offers. A merchant onboarding a real catalogue had to add every offer
by hand — about forty seconds each, so two hundred SKUs was an afternoon — because a row matching no
existing offer was reported as `no_matching_offer` and dropped. Now it becomes a **draft offer** and goes
through the ordinary `offers.review` approval.

Nothing about the review model changes. A merchant still cannot publish supply; a reviewer still sees every
new offer before a customer can buy it. What changes is the typing.

**Off by default, per paste.** The nightly stock file is the common paste, and there a mistyped SKU must
report itself rather than quietly become an offer at a price nobody checked — so `p_create` is a checkbox
the merchant ticks when the sheet is new supply.

**Two more columns**, both of which a new offer needs and an existing one keeps if the column is absent:
`handling_days` (the dispatch promise the scorecard measures against) and `low_stock_threshold`. There is
deliberately **no `condition` column**: `merchant_offers` has none, every supplement on the site is sold
new, and an enum with one member is a migration in exchange for nothing.

**A creation matches on BioCode's key, not the merchant's.** An update matches `merchant_sku` first and
falls back to our `sku`; a creation has no offer to read a `merchant_sku` from, so the key is the variant
`sku` or its `barcode`. Which is why the page hands out a **catalogue export** — a merchant guessing at our
codes fills its report with `unknown_sku`. The export's most useful column is `ka_stok_biocode`: where
BioCode is short is exactly where a merchant's offer wins the buy box.

**The variant must belong to a published product.** Two reasons, and the second is the one that matters: an
offer on an unpublished product would sit on a page no customer can reach, and a lookup that answered for
drafts would make this function an oracle for probing whether BioCode is preparing to list something. A
draft answers `unknown_sku`, the same as a code that does not exist.

Every refusal has its own reason, because each needs a different thing from the merchant:

| Reason              | What it means                                             |
| ------------------- | --------------------------------------------------------- |
| `unknown_sku`       | no published variant carries that SKU or barcode          |
| `price_required`    | a new offer needs a price; there is no sensible default   |
| `awaiting_review`   | the merchant's offer on that variant is mid-review — wait |
| `offer_rejected`    | it was rejected: open the offer and read the note         |
| `no_matching_offer` | the row matched nothing and creation was not ticked       |

**The scorecard is observed, not entered.** `rating_avg` is a buy-box tie-break, so it decides which of
two equally-priced merchants gets the sale — that makes it a number that has to be earned by something
observable. Four measures: acceptance rate, acceptance speed, dispatch speed against **the offer's own
handling promise**, and cancellation after acceptance. Deliberately not a customer review score: a
merchant is a supplier the customer never contracts with and mostly cannot name.

Rates are `null`, not zero, with no history — and no history rates 0/5, which loses every tie-break
rather than winning one it has not earned. The merchant sees its own scorecard: a measurement that
decides revenue and cannot be seen by the party it measures is a secret.

---

## 9.2 · Merchants are blind to BioCode's prices and stock

**Owner decision, 2026-08-05.** A merchant must not be shown what BioCode charges for a product, or
whether BioCode has it in stock.

### What changed

- `catalogue_export()` — the file and API a merchant pulls to match SKUs — returned `price_cents` and
  `in_stock` for up to 5000 variants. Both columns are gone; it is identifiers only.
- The offer picker printed BioCode's shelf price beside every search result. The price is still fetched,
  because settlement is derived from it, but it stops on the server:
  `CatalogVariantOption.retailPriceCentsInternal` is named so that widening a props object is an act
  somebody has to notice.
- The offer form's three-number panel is now two: what the merchant asks, and what settlement pays.

### What it does not achieve, and why saying so matters

**It does not make prices secret, and nothing can.** `product_variants` is world-readable for published
products — that is what serves the shop — so a merchant can read every retail price by opening the
storefront, or straight off the anon API. Verified against the live database rather than assumed.

What was removed is the _convenience_: a sorted, machine-readable price list of the whole catalogue,
produced on request. Reading 91 prices off a website one at a time and downloading them as a spreadsheet
are different activities, and only the second was something BioCode was doing for merchants.

Two smaller leaks are inherent and left in place, because closing them would take away something the
merchant legitimately needs:

- **Settlement implies the price.** A merchant sees what they are paid per unit and their own commission
  rate, so the shelf price is one division away. They cannot price an offer without the first number.
- **The buy box names the supplier.** `variant_buy_box` returns who supplies a variant and a bucketed
  stock status — no prices, no numbers — and all of it is already on the public product page.

### What was already safe

Rival merchants' prices and stock were never exposed. `p_own_read on merchant_offers` scopes reads to
`current_merchant_ids()`, so a merchant has only ever seen its own offers. `inventory_levels` is
staff-only, so BioCode's stock _numbers_ have never been readable by anyone else.

### A bug this fixed on the way

`in_stock` had never worked. `catalogue_export()` is `security invoker` and `inventory_levels` is
staff-only, so the `sum(on_hand)` subquery returned null for every non-staff caller,
`coalesce(…, 0) > 0` was false, and every merchant who pulled the catalogue was told BioCode is out of
stock on all 71 published variants. The column's own comment called it "the most useful column in the
file". Removing it is the fix as well as the policy.

### Unchanged: merchants still upload whatever they like

The other half of the same instruction — merchants upload products, admin decides what is published — is
§4 and §9.1, and already worked that way. A proposal takes a free-text brand and form, so it is not
limited to what BioCode already lists; the caps (twenty open proposals, 200 rows a batch, three open
batches) are protection for the reviewer's queue, not a restriction on what may be proposed.

## 10–11 · Terms and admin surfaces — done

Terms live at `/legal/marketplace-terms`, **version `1.1`**, and are recorded at submission with their
version. 1.1 adds clause 14 — the images and content a seller supplies, and the rights it warrants it
holds in them — which is what §9's photograph upload rests on. Merchants who accepted `1.0` are **not**
re-prompted: there is no re-acceptance flow, and that gap is recorded in docs/14 §19 as the item the
30-day notice clause hangs off.

Admin surfaces: applications, offers, proposals, routing, payouts — each behind the capability docs/01 §3
gives it, and each re-checked inside the SQL so a future cron cannot route around the page.

---

## Testing, at the end of M12

| Suite       | Count | What it is for                                                              |
| ----------- | ----- | --------------------------------------------------------------------------- |
| Unit        | 308   | Pure logic: money, both CSV parsers, filename keys, payout periods, schemas |
| Integration | 354   | RLS, triggers, and every SQL function, against a real database              |
| E2E         | 484   | The journeys and a11y, on desktop and a 390 px viewport                     |

Marketplace-specific: 42 isolation, 15 onboarding, 19 buy box, 24 offers, 29 routing, 29 ledger,
44 scorecard/bulk/proposals, 24 batches, 17 emails/auto-routing; 58 E2E across two spec files.

The proposal-images journey (§9) is the one worth reading for what it asserts _last_: the merchant's
photograph is on the draft product, the reviewer could see it before approving — and the product's own URL
answers **404** to a shopper. A feature whose whole point is "approved images appear on the site" needs the
assertion that says _not until somebody publishes it_.

The isolation suite (§3) remains the definition of done for the security model, and it asserts in
**both** directions — merchant A can read its own, and reads zero of merchant B's — which is what stops
it passing vacuously.

---

## 12 · Build order

1. ~~Migration + `current_merchant_ids()` + full RLS isolation suite~~ — **done, 42 green**
2. ~~Merchant onboarding + admin application review + role/membership middleware~~ — **done, 15 green**
3. ~~Portal shell + offers CRUD + admin offer approval + buy box on PDP~~ — **done, 65 green**
4. ~~`route_order` + fulfilment model + `/admin/routing` + accept/decline/ship + partial shipments~~ — **done**
5. ~~Ledger + payouts + statements~~ — **done**
6. ~~Proposals; CSV bulk stock/price; scorecard~~ — **done**
7. ~~Emails~~ — **done**
8. ~~Optional auto-routing behind the setting~~ — **done**
9. ~~E2E + a11y + perf; seed two demo merchants with overlapping SKUs~~ — **done**

Added after M12 closed, because onboarding a real merchant needs both:

10. ~~Photographs on a proposal; approving creates a draft product carrying them~~ — **done (§9)**
11. ~~Bulk offer _creation_ from the same paste, with a catalogue export~~ — **done (§6.1)**
12. ~~Pasted catalogues as batches, photographs keyed by filename, promotion swept by cron~~ — **done (§9.1)**

---
