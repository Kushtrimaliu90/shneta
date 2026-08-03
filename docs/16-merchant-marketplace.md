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

| Table                | Holds                                                         |
| -------------------- | ------------------------------------------------------------- |
| `merchants`          | Identity, ARBK number, bank, commission, status, terms version |
| `merchant_users`     | Which profiles act for which merchant                         |
| `merchant_documents` | KYB uploads; `storage_path` into a **private** bucket         |
| `merchant_offers`    | One per (merchant, variant): price, stock, handling, status    |
| `product_proposals`  | A merchant asking for a new canonical product                 |
| `order_fulfilments`  | An order splits into one row per fulfiller                    |
| `merchant_ledger`    | Append-only, **signed**: `+` owed to the merchant, `−` by it   |
| `merchant_payouts`   | Per-cycle statements                                          |

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

## 4–11 · Onboarding, portal, routing, money, admin

Not yet built. §12's order is deliberate and step 1 gates the rest.

---

## 12 · Build order

1. ~~Migration + `current_merchant_ids()` + full RLS isolation suite~~ — **done, 42 green**
2. Merchant onboarding + admin application review + role/membership middleware
3. Portal shell + offers CRUD + admin offer approval + buy box on PDP
4. `route_order` + fulfilment model + `/admin/routing` + accept/decline/ship + partial shipments
5. Ledger + payouts + statements
6. Proposals; CSV bulk stock/price; scorecard
7. Emails
8. Optional auto-routing behind the setting
9. E2E + a11y + perf; seed two demo merchants with overlapping SKUs

---

## Business decisions still open

- **Shipping cost on merchant fulfilments.** `settings.marketplace.shipping_cost_absorbed` defaults
  to `true` — BioCode charges the customer one shipping fee and keeps the cost. Deducting a
  per-fulfilment rate from the merchant's due is the alternative and needs a number nobody has given.
- **Marketplace terms.** Not written. Must cover commission, payout cycle, authenticity and import
  legality, prohibited claims, the handling-time SLA, return liability, suspension grounds, and the
  merchant's position as a **processor** for the shipping data it receives, purpose-limited to
  fulfilment. `[LEGAL: review]` — no binding text invented.
