# 18 · MERCHANT API

A third-party merchant with its own ERP, warehouse tool or spreadsheet macro pushes stock and prices
to BioCode, creates offers, proposes products with photographs, handles the orders routed to it, and
is told when something changes — without a person in the portal. This document is both the reference
a merchant's developer reads and the record of the decisions behind it.

The API is a **second door onto the portal's existing functions**, not a second implementation. Every
rule the portal enforces — a merchant cannot approve its own offer, a price change on a live offer
goes back to review, three open proposal batches, the fulfilment lane, `delivered` is not the
merchant's word — applies to an API call identically, because the call runs through the same stored
procedures and the same triggers as the portal does.

---

## 1 · How identity works

Every merchant-facing policy and trigger in the database (docs/16 §3) is written in terms of
`current_merchant_ids()`. Until this feature that meant "the merchants the signed-in user belongs
to". An API call has no signed-in user, so the question was how to make it one.

Three options were weighed:

1. **The route resolves the key and calls the RPCs as the service role.** Rejected. The service
   client bypasses every trigger that makes "a merchant cannot approve its own offer" true, and
   docs/16 §5 is explicit that it must never appear in the merchant lane. One bug in a route that
   passed the wrong merchant id would be a cross-merchant write with nothing in the database to
   refuse it.
2. **Mint a Supabase JWT for the user who created the key.** Rejected. It binds the key to a person
   who may leave the business, and it needs the project's JWT signing secret inside the app, which
   is one more credential to rotate and one more way for a key to outlive its owner.
3. **Teach `current_merchant_ids()` a second source of identity.** Chosen. `merchant_api_exec`
   verifies the key and its scope, then writes the merchant id into a **transaction-local setting**
   (`app.api_merchant_id`) that `api_merchant_id()` reads and `current_merchant_ids()` unions in.
   Everything downstream — RLS, `guard_merchant_offer_write`, `guard_fulfilment_transition`, the
   price-change demotion, the batch caps — sees an API call as the merchant and nothing more.

Why the setting is trustworthy: `set_config(…, true)` dies with the transaction and PostgREST runs
each RPC in its own, so it cannot leak into the next request on the same connection. It can only be
written from SQL, and PostgREST exposes no way to run arbitrary SQL — only the functions in `public`,
none of which take a setting name. Staff, who could in principle write one through a migration,
already hold more than any merchant does.

**The route holds nothing.** It extracts the bearer token, rate-limits, validates the body, and calls
`merchant_api_exec` through the **anon** client with no session. The JWT on the wire grants nothing;
the credential is the key inside the argument. `src/lib/supabase/public.ts` records this as its one
sanctioned write path.

**Where the service client does appear**, and why each is safe, is in §3.5 (photographs: the bytes
are written to a path the SQL minted, never one the caller named), §3.4 (the release after a decline:
the same step the portal takes, after the merchant's own transition has committed) and §3.6 (the
delivery cron). All three are listed in docs/02 §6.

### The key

- Format `bck_live_` + 43 characters of base64url (32 random bytes). Generated in
  `features/merchants/api-keys.ts`, shown **once** on the portal, never stored.
- The database holds `sha256(token)` as hex, plus the first 13 characters as `key_prefix` so a
  merchant can tell keys apart. A leaked dump contains nothing usable as a credential.
- **Scopes** (§2.1) are chosen at creation and frozen. A merchant wanting different scopes makes a
  new key and retires the old one, so the portal's list is always what each key could ever do.
- Five active keys per merchant, approved merchants only, revocation is one-way — all enforced by
  `guard_merchant_api_key_write`, so an admin tool or a script meets the same wall as the portal.
- `last_used_at` is bumped by the entry point, throttled to once a minute.
- A suspended or rejected merchant's keys stop working at once: the entry point checks the merchant's
  status on every call, and `current_merchant_ids()` excludes it a second time.

---

## 2 · Conventions

| Thing              | Rule                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Base URL           | `https://biocode.fit/api/v1/merchant`                                                        |
| Authentication     | `Authorization: Bearer bck_live_…` on every request                                          |
| Bodies             | JSON, `Content-Type: application/json`, at most 2 MB (images: raw bytes or multipart, 2 MB)  |
| Money              | **Integer cents**, EUR (CLAUDE.md §2). `990` is €9.90. There is no euro field.               |
| Envelope           | `{ "ok": true, "data": … }` or `{ "ok": false, "error": "<code>", "details"?: … }`           |
| Caching            | Every response is `Cache-Control: private, no-store`                                         |
| Rate limit         | 600 calls per hour per key → `429 rate_limited`; failed authentications 30 per 15 min per IP |
| Unknown properties | Refused with `400 invalid_body` — a misspelt `price_cent` must not silently do nothing       |
| Ids                | UUIDs. A malformed one is `404 not_found`, the same as somebody else's.                      |

Error codes are stable machine strings, never sentences. The HTTP status carries the same information,
so a client can branch on either.

### 2.1 Scopes

| Scope             | Lets the key                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `catalogue:read`  | `GET /catalogue`                                                      |
| `offers:read`     | `GET /offers`                                                         |
| `offers:write`    | `POST /offers`                                                        |
| `proposals:read`  | `GET /proposals`, `GET /proposals/{batchId}`                          |
| `proposals:write` | `POST /proposals`, `POST /proposals/{batchId}/rows/{rowId}/images`    |
| `orders:read`     | `GET /fulfilments`, `GET /fulfilments/{id}`                           |
| `orders:write`    | `POST /fulfilments/{id}/accept`, `/pack`, `/ship`, `/decline`         |
| `webhooks:read`   | `GET /webhooks`, `GET /webhooks/{id}/deliveries`                      |
| `webhooks:write`  | `POST /webhooks`, `PATCH`/`DELETE /webhooks/{id}`, `/rotate`, `/ping` |

`GET /me` needs no scope. A key without the scope an endpoint needs gets `403 insufficient_scope`
with `details.required_scope` — that one the merchant can fix, so it is named. The mapping lives in
`merchant_api_scope_for` in SQL and is mirrored in `features/merchants/api/scopes.ts`; the integration
suite asserts the two agree. On the portal, `orders:*` is unticked by default because it is the one
scope that reaches a customer's address.

---

## 3 · Endpoints

### 3.1 `GET /me`

Who the key belongs to and what it may do. The first call every integration makes.

```json
{
  "ok": true,
  "data": {
    "merchant": {
      "id": "…",
      "slug": "alpha-pharma",
      "display_name": "Alpha Pharma",
      "status": "approved"
    },
    "key": {
      "name": "ERP nightly sync",
      "prefix": "bck_live_ab12",
      "scopes": ["offers:read", "offers:write"],
      "created_at": "…"
    }
  }
}
```

### 3.2 `GET /catalogue`

Every published BioCode variant: SKU, barcode and the two names (Albanian, falling back to English).
**No retail price and no BioCode stock** — the owner decision of 2026-08-05 (docs/16 §9.2) applies to
the API exactly as to the portal export. Capped at 5000 rows.

```json
{
  "ok": true,
  "data": [
    {
      "sku": "BC-0042",
      "barcode": "8712345678901",
      "product_name": "Vitamina D3",
      "variant_name": "60 kapsula"
    }
  ]
}
```

### 3.3 `GET /offers` and `POST /offers`

**GET** returns the merchant's own offers, every status, newest change first:

```json
{
  "ok": true,
  "data": [
    {
      "id": "…",
      "sku": "BC-0042",
      "barcode": "8712345678901",
      "merchant_sku": "ART-114",
      "product_name": { "sq": "Vitamina D3", "en": "Vitamin D3" },
      "variant_name": { "sq": "60 kapsula", "en": "60 capsules" },
      "status": "approved",
      "stock_on_hand": 120,
      "price_cents": 990,
      "handling_days": 1,
      "low_stock_threshold": 3,
      "rejection_note": null,
      "created_at": "…",
      "updated_at": "…"
    }
  ]
}
```

`price_cents` is the merchant's **asking price**, what it asks BioCode for the unit. The customer-facing
price is the canonical variant price and never reaches the API (docs/16 §5).

**POST** applies stock, price, dispatch days and low-stock level for up to **2000** rows in one
transaction and reports what it could not apply, row by row:

```json
{
  "rows": [
    { "sku": "ART-114", "stock": 120 },
    { "sku": "BC-0042", "price_cents": 950, "handling_days": 2 },
    { "sku": "8712345678901", "stock": 0 }
  ],
  "create": false
}
```

| Field                 | Type    | Range        | Absent means                                     |
| --------------------- | ------- | ------------ | ------------------------------------------------ |
| `sku`                 | string  | 1–64 chars   | required                                         |
| `stock`               | integer | 0–1 000 000  | leave stock alone                                |
| `price_cents`         | integer | 1–10 000 000 | leave the price alone (required for a new offer) |
| `handling_days`       | integer | 0–30         | leave it alone; `1` for a new offer              |
| `low_stock_threshold` | integer | 0–10 000     | leave it alone; `3` for a new offer              |
| `create`              | boolean |              | `false` — a row matching no offer is reported    |

**Matching** (`merchant_bulk_upsert_offers`, docs/16 §6.1): an update matches the merchant's own
`merchant_sku` first and BioCode's `sku` second, among the offers the merchant may edit (`draft`,
`approved`, `paused`). With `create: true`, a row matching none of them is looked up as a BioCode
`sku` or `barcode` on a **published** product and becomes a **draft** offer — which the merchant
then submits for review in the portal, and which a reviewer approves before a customer can buy it.

**Response:** `{ "applied", "created", "skipped": [{ "sku", "reason" }], "skipped_count" }`.

| `reason`            | Meaning                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `no_sku`            | the row had no SKU                                                  |
| `negative_stock`    | stock below zero                                                    |
| `invalid_price`     | price not above zero                                                |
| `invalid_handling`  | dispatch days outside 0–30                                          |
| `invalid_threshold` | low-stock level below zero                                          |
| `nothing_to_change` | the row named an offer and set nothing                              |
| `no_matching_offer` | no offer of yours matched and `create` was false                    |
| `unknown_sku`       | `create` was true and no published variant carries that SKU/barcode |
| `awaiting_review`   | your offer on that variant is `pending_review` — wait               |
| `offer_rejected`    | your offer on that variant was rejected — read the note             |
| `price_required`    | a new offer needs `price_cents`                                     |

**A price change on a live offer sends it back to review** (migration 80): the offer's `status`
becomes `pending_review` and it is off the shelf until a reviewer looks, and an `offer.review_required`
webhook fires. Stock, dispatch days and the threshold are exempt.

### 3.4 Fulfilments — `GET /fulfilments`, `GET /fulfilments/{id}`, `POST /fulfilments/{id}/{verb}`

Scopes `orders:read` / `orders:write`.

**`GET /fulfilments?status=assigned`** — summaries of the orders routed to this merchant, through the
same `merchant_fulfilment_list` the portal reads. Order number, line and unit counts, this
fulfilment's money, the COD amount to expect. **No address, no customer, no order total.**
`status` is one of `assigned`, `accepted`, `packed`, `shipped`, `delivered`, `cancelled`, `returned`.

**`GET /fulfilments/{id}`** — the one read path from a merchant into order data (docs/16 §3), a fixed
shape:

```json
{
  "ok": true,
  "data": {
    "fulfilment": {
      "id": "…",
      "status": "assigned",
      "assigned_at": "…",
      "accepted_at": null,
      "packed_at": null,
      "shipped_at": null,
      "carrier": null,
      "tracking_code": null,
      "items_subtotal_cents": 2980,
      "merchant_due_cents": 2533
    },
    "order_number": "BC-240915-0031",
    "placed_at": "…",
    "delivery_method": { "name": "Standard" },
    "items": [
      {
        "name": "Vitamina D3 60 kapsula",
        "sku": "BC-0042",
        "quantity": 2,
        "unit_price_cents": 1490,
        "total_cents": 2980
      }
    ],
    "ship_to": {
      "name": "A. Buyer",
      "phone": "+383 4x …",
      "address": { "line1": "…", "city": "Prishtinë", "country_code": "XK" }
    },
    "cod_amount_cents": 2980
  }
}
```

`ship_to` is `null` until the fulfilment is assigned to this merchant, and `cod_amount_cents` is
**this fulfilment's subtotal, never the order total**. Somebody else's id is `404 not_found`.

**The four verbs** — each posts a status and lets `guard_fulfilment_transition` judge it, exactly as
the portal's actions do (docs/16 §7). The lane is `assigned → accepted → packed → shipped`, with
`decline` allowed from `assigned` and `accepted`. Anything else is `409 wrong_state`.

| Call                             | Body                                      | Then                                                              |
| -------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| `POST /fulfilments/{id}/accept`  | none                                      | ops alert to BioCode                                              |
| `POST /fulfilments/{id}/pack`    | none                                      | ops alert                                                         |
| `POST /fulfilments/{id}/ship`    | `{ "carrier", "tracking_code" }` required | order becomes shipped / partially shipped; customer dispatch mail |
| `POST /fulfilments/{id}/decline` | `{ "reason" }` 5–500 chars, required      | stock reservation released, back to the routing queue             |

`accept`, `pack` and `ship` return the fulfilment view; `decline` returns `{ fulfilment_id, status: "cancelled" }`.
**`delivered` is not a verb and never will be**: the courier's word is BioCode's to record, because a
merchant that could mark its own parcels delivered could trigger its own payout. Timestamps are
stamped by the database, so an SLA cannot be backdated.

The release after a decline is the one privileged step: `release_fulfilment` moves stock and money and
is staff-gated, and the merchant declining is the one legitimate case of a non-staff actor needing it.
It runs with the service client **after** the merchant's own transition has committed, is passed
nothing but the row's id, and is the same entry as the portal's `fulfilment-actions.ts` in docs/02 §6.
If it fails, the decline stands and an admin re-routes by hand from `/admin/routing`.

### 3.5 Proposals — `GET`/`POST /proposals`, `GET /proposals/{batchId}`, `POST …/rows/{rowId}/images`

Scopes `proposals:read` / `proposals:write`.

**`POST /proposals`** proposes up to **200** products BioCode does not list, as one batch a reviewer
decides as one queue item (docs/16 §9.1). At most **three** open batches per merchant.

```json
{
  "note": "Autumn catalogue, all in stock in Prishtina",
  "rows": [
    {
      "product_name": "Magnesium Glycinate",
      "brand_name": "NutriLab",
      "asking_price_cents": 1250,
      "stock_on_hand": 40,
      "form": "capsules",
      "variant_name": "120 capsules",
      "barcode": "8712345678902",
      "merchant_sku": "NL-MG-120",
      "source_url": "https://nutrilab.example/mg"
    }
  ]
}
```

| Field                | Type    | Range           | Required |
| -------------------- | ------- | --------------- | -------- |
| `product_name`       | string  | 2–160           | yes      |
| `brand_name`         | string  | 2–120           | yes      |
| `asking_price_cents` | integer | 1–10 000 000    | yes      |
| `stock_on_hand`      | integer | 0–1 000 000     | no (`0`) |
| `form`               | string  | ≤ 80, free text | no       |
| `variant_name`       | string  | ≤ 120           | no       |
| `barcode`            | string  | ≤ 32            | no       |
| `merchant_sku`       | string  | ≤ 64            | no       |
| `source_url`         | URL     | ≤ 500           | no       |
| `note`               | string  | ≤ 2000, per row | no       |

Response: `{ "batch_id", "created", "skipped": [{ "name", "reason" }], "skipped_count" }`. Reasons:
`incomplete`, `no_price`, `negative_stock`, `duplicate_in_sheet`, `already_proposed`. A batch whose
every row was refused leaves nothing behind and returns `batch_id: null`.

**`GET /proposals`** lists batches, newest first, with a per-status row count.
**`GET /proposals/{batchId}`** returns one batch with its rows — each row's `id`, status,
identifiers, `image_count`, reviewer note and, once promoted, `created_product_id`. The row ids are
what the photograph upload is keyed on.

**`POST /proposals/{batchId}/rows/{rowId}/images`** — one photograph of the box. The body is either
the raw image bytes with their `Content-Type`, or `multipart/form-data` with a `file` field.
**JPEG, PNG, WebP or AVIF, 2 MB, six per row**, and only while the batch is still pending — the same
limits as the portal and the bucket.

```bash
curl -X POST "$BASE/proposals/$BATCH/rows/$ROW/images" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: image/jpeg" --data-binary @box-front.jpg
# → { "ok": true, "data": { "attached": 1, "path": "proposals/<merchant>/api-….jpg", "proposal_id": "…" } }
```

Errors: `415 unsupported_media_type`, `413 too_large`, `409 too_many_images`, `409 batch_decided`,
`404 not_found` for a row that is not in this merchant's batch.

How it stays safe, since this is the one route that writes to storage with the service client: the
SQL first runs **as the merchant** (`proposals.image_slot`) and decides whether this row may take a
photograph — the batch is theirs and pending, the row is in it and open, fewer than six images — and
mints the exact object path under the merchant's own prefix with a server-chosen name. The bytes go
to that path and nowhere else. Then `proposals.attach_image` runs as the merchant again through
`merchant_attach_batch_images`, which re-checks the prefix, the batch and the row. The service client
never acts on a caller-supplied path and never writes a row. If the attach refuses (a sixth image
raced in), the object is removed again.

**What approving does**: a reviewer approves the batch, each approved row becomes a **draft** product
carrying the merchant's photographs and data, and the merchant gets an offer on it. Nothing a merchant
proposes reaches a customer until compliance publishes the product (docs/16 §9). The webhooks
`proposal.approved`, `proposal.rejected`, `proposal.needs_info`, `proposal.product_created` and
`batch.decided` tell the merchant's system each step.

### 3.6 Webhooks — `GET`/`POST /webhooks`, `PATCH`/`DELETE /webhooks/{id}`, `/deliveries`, `/ping`, `/rotate`

Scopes `webhooks:read` / `webhooks:write`. Five endpoints per merchant, https only.

**`POST /webhooks`** `{ "url", "events": [...], "description"? }` → the endpoint **with its signing
secret, shown once**:

```json
{
  "ok": true,
  "data": {
    "id": "…",
    "url": "https://erp.example/hooks/biocode",
    "events": ["offer.approved"],
    "status": "active",
    "secret": "whsec_…"
  }
}
```

| Event                      | Fires when                                          | `data` carries                                                                  |
| -------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ping`                     | `POST /webhooks/{id}/ping`                          | `webhook_id`                                                                    |
| `offer.approved`           | a reviewer approves your offer                      | `offer_id, variant_id, merchant_sku, status`                                    |
| `offer.rejected`           | a reviewer rejects it                               | … plus `rejection_note`                                                         |
| `offer.review_required`    | a price change took a live offer back to review     | as above                                                                        |
| `proposal.approved`        | a row of a batch (or a single proposal) is approved | `proposal_id, batch_id, status, reviewer_note, …`                               |
| `proposal.rejected`        | … rejected                                          | as above                                                                        |
| `proposal.needs_info`      | … sent back for more information                    | as above                                                                        |
| `proposal.product_created` | the draft product for an approved row exists        | `proposal_id, batch_id, product_id, merchant_sku, barcode`                      |
| `batch.decided`            | a reviewer answered the whole batch                 | `batch_id, row_count, approved, rejected, reviewer_note`                        |
| `fulfilment.assigned`      | an order was routed to you — go and accept it       | `fulfilment_id, status, order_number, items_subtotal_cents, merchant_due_cents` |
| `fulfilment.cancelled`     | it was cancelled (including by your own decline)    | … plus `cancel_reason`                                                          |
| `fulfilment.delivered`     | BioCode recorded delivery — settlement follows      | as `assigned`                                                                   |
| `fulfilment.returned`      | the parcel came back                                | as `assigned`                                                                   |
| `payout.approved`          | a payout statement was approved                     | `payout_id, status`                                                             |
| `payout.paid`              | it was paid                                         | `payout_id, status`                                                             |

Payloads carry **identifiers and status**, nothing a merchant could not already read through the
API: a fulfilment event names the fulfilment, not the customer — the merchant fetches the view.

**Delivery.** Events are enqueued by database triggers the moment the row changes, whoever changed it
(a server action, a cron, a reviewer's bulk decision). A cron drains the queue **every five minutes**:
each delivery is a `POST` to your URL with a ten-second timeout, and any `2xx` counts as delivered.
Anything else is retried after 1 min, 5 min, 30 min, 2 h and 12 h, then marked `failed`. An endpoint
that fails **twenty-five attempts in a row** is disabled automatically (`disabled_reason:
too_many_failures`); `PATCH /webhooks/{id}` with `{ "status": "active" }` re-enables it.

```http
POST /hooks/biocode HTTP/1.1
Content-Type: application/json
User-Agent: BioCode-Webhooks/1
X-BioCode-Event: offer.approved
X-BioCode-Delivery: 7a1c…
X-BioCode-Signature: t=1760000000,v1=5f8a…

{"id":"7a1c…","event":"offer.approved","created_at":"…","attempt":1,"merchant_id":"…","data":{"offer_id":"…","status":"approved"}}
```

**Verifying.** `v1` is `HMAC-SHA256(secret, "<t>.<raw body>")` in hex, over the exact bytes received
— verify before parsing. Reject if `|now − t|` exceeds a few minutes. The reference implementation is
`verifyWebhookSignature` in `features/merchants/webhooks/signature.ts`, 25 lines, tested in
`tests/unit/merchant-webhook-signature.test.ts`; copy it. Deliveries are at-least-once: a receiver
should treat the delivery `id` as idempotency key.

**`GET /webhooks/{id}/deliveries`** — the last fifty attempts: status, attempts, next scheduled try,
last HTTP status and error. This is where "the webhook is not firing" is usually answered: it is, and
the endpoint is returning 500 or taking longer than ten seconds.

**`POST /webhooks/{id}/rotate`** — a new secret, shown once, in force immediately. Update the receiver
first. **`DELETE /webhooks/{id}`** removes the endpoint and its delivery history.

The secret is stored in the clear because it signs payloads at delivery time and a hash cannot sign.
It is a secret for _verifying our calls_, not a credential for calling us: a leaked one lets somebody
forge a notification to the merchant, never read or write anything here.

---

## 4 · Errors

| HTTP | `error`                  | When                                                                    |
| ---- | ------------------------ | ----------------------------------------------------------------------- |
| 401  | `unauthorized`           | no bearer, malformed, unknown, revoked, or the merchant is not approved |
| 403  | `insufficient_scope`     | the key lacks the scope; `details.required_scope` names it              |
| 429  | `rate_limited`           | more than 600 calls in an hour on this key                              |
| 400  | `invalid_body`           | not JSON, or the schema refused it — `details` lists path and message   |
| 413  | `too_large`              | body over 2 MB                                                          |
| 415  | `unsupported_media_type` | an image that is not JPEG, PNG, WebP or AVIF                            |
| 404  | `not_found`              | not this merchant's row, or no such row — the same answer for both      |
| 409  | `wrong_state`            | the fulfilment lane does not allow that move from here                  |
| 409  | `batch_decided`          | the batch is no longer pending, so it takes no more photographs         |
| 409  | `too_many_images`        | the row already has six                                                 |
| 422  | `too_many_rows`          | over 2000 offer rows or 200 proposal rows                               |
| 422  | `too_many_open_batches`  | three batches already awaiting review                                   |
| 422  | `too_many_webhooks`      | five endpoints already registered                                       |
| 422  | `empty`                  | no rows                                                                 |
| 500  | `internal`               | something on our side; logged with the action name, never the key       |

`401` is the same answer for every authentication failure on purpose. A response that said "revoked"
rather than "unknown" would confirm a key once existed.

---

## 5 · The portal and admin screens

**`/merchant/api`**, approved merchants only, in the nav beside Documents:

- **Create key** — a name, nine scope checkboxes (order handling off by default), one click, the token
  shown once with a copy button. Disabled at five active keys with the count beside it.
- **Your keys** — name, prefix, scopes, created, last used, status; revoke on the active ones, behind
  a confirm. Revoked keys stay listed, greyed.
- **Using the API** — base URL, the header, every endpoint, one `curl`, and the three things a
  developer most needs to hear before the first call.

Webhook endpoints are managed through the API itself (§3.6); they are a developer's tool and the
developer has a key.

**`/admin/merchants/api`**, under Marketplace in the admin nav. `merchants.view` opens it;
`merchants.manage` is what the buttons check:

- every merchant's keys (active / revoked filter) with scopes and last use, and **Revoke**;
- every merchant's webhook endpoints with status, consecutive failures, queue counts, and
  **Disable** / **Enable** — which also resets the failure counter.

Each action writes an audit row (`merchant.api_key_revoked`, `merchant.webhook_disabled`,
`merchant.webhook_enabled`). Nothing on the screen can read a key or a secret.

---

## 6 · Files

| Path                                                                             | Holds                                                                                          |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `supabase/migrations/20261015000100_merchant_api_keys.sql`                       | keys with scopes, webhooks and deliveries, guards, triggers, `claim`/`record`, the entry point |
| `src/features/merchants/api-keys.ts`                                             | key and secret generation, hashing, bearer parsing — pure                                      |
| `src/features/merchants/api/scopes.ts`                                           | scopes, the action→scope map, the event list — pure, mirrored from SQL                         |
| `src/features/merchants/api/schemas.ts`                                          | request bodies (Zod)                                                                           |
| `src/features/merchants/api/exec.ts`                                             | the one RPC call, mapped onto `ExecResult`                                                     |
| `src/features/merchants/api/handler.ts`                                          | authenticate → rate limit → body/query → exec → envelope, plus the pieces for the image route  |
| `src/features/merchants/api/images.ts`, `image-types.ts`                         | the photograph upload: slot → bytes → attach                                                   |
| `src/features/merchants/api/fulfilment-side-effects.ts`                          | release after a decline, ops alert                                                             |
| `src/features/merchants/webhooks/signature.ts`, `deliver.ts`                     | signing and verifying; claiming, posting, recording                                            |
| `src/app/api/v1/merchant/**`                                                     | the routes, thin                                                                               |
| `src/app/api/cron/webhooks/route.ts`                                             | the delivery cron, every five minutes                                                          |
| `src/features/merchants/api-key-actions.ts`, `api-key-queries.ts`                | the portal's create / revoke / list                                                            |
| `src/features/merchants/api-admin-actions.ts`, `api-admin-queries.ts`            | the admin's revoke / enable / disable / list                                                   |
| `src/features/merchants/components/api-keys-panel.tsx`, `api-admin-panel.tsx`    | the two screens' tables and forms                                                              |
| `src/app/[locale]/merchant/api/page.tsx`, `src/app/admin/merchants/api/page.tsx` | the pages                                                                                      |
| `tests/unit/merchant-api-*.test.ts`, `merchant-webhook-signature.test.ts`        | key format and hashing, scopes, schemas, image types, signatures                               |
| `tests/integration/merchant-api.test.ts`, `merchant-api-v2.test.ts`              | the entry point against a real database, both directions, every feature                        |

---

## 7 · Not in this version, said plainly

- **A sandbox tier.** The prefix leaves room for `bck_test_`; nothing issues one.
- **Immediate webhook delivery.** Deliveries wait for the five-minute cron rather than being pushed at
  commit time; a merchant that needs sub-minute latency polls `GET /fulfilments?status=assigned`.
- **Pagination.** Lists are capped (offers 5000, batches 100, deliveries 50) rather than paged, which
  is adequate for the catalogue sizes the marketplace has and would be the first thing to add past
  them.
- **A portal screen for webhooks.** The policies on `merchant_webhooks` already admit a merchant's
  own session, so one could be added without touching the schema.
