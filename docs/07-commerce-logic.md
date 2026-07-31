# 07 · Commerce Logic (rule book)

Business rules win over UI convenience. All money = integer cents EUR; all computations server-side; the checkout RPC (docs/03 §8) is the single write path for orders.

## 1. Pricing

- `product_variants.price_cents` is the **VAT-inclusive consumer price**. `compare_at_price_cents` (must be > price) drives sale badges and struck prices; discount % badge = `round((1 - price/compare_at) * 100)`.
- Price-per-serving on compare page = price / serving count parsed from variant name/options when numeric, else omitted.
- Price changes affect only future orders (order_items snapshot). Cost (`cost_cents`) is internal margin data — never queried by storefront code.

## 2. Totals algorithm (canonical; implemented in the RPC and mirrored in `lib/money.ts` for UI preview — tests assert parity)

```
subtotal = Σ variant.price_cents × qty                 (live DB prices)
discount = coupon: percentage → floor(subtotal × v/100)
                   fixed      → min(v, subtotal)
                   free_shipping → 0 (applies below)
shipping = 0 if coupon.free_shipping
           0 if method.free_over && (subtotal − discount) ≥ free_over
           else method.price_cents
total    = subtotal − discount + shipping
tax      = round(total × rate / (100 + rate))          (informational; rate from settings.tax, default 18)
```

Rounding: integer math, floor on percentage discount, half-up on tax. Order stores all five figures.

## 3. Cart

**3.1 Model:** DB-backed (`carts`/`cart_items`), one active cart per identity. Authenticated: `user_id` cart via RLS. Guest: cart with `anon_token`; token stored in httpOnly, Secure, SameSite=Lax cookie `shneta_cart` (1 year); all guest cart ops go through server actions using the admin client filtered by token (docs/02 §6). Client keeps a lightweight mirror (TanStack Query) for the drawer; server is truth.
**3.2 Rules:** qty 1–20 per line (settings); adding existing variant increments; inactive/unpublished variants are pruned on read with a notice; stock is _not_ reserved by carting (only checkout decrements) but add-to-cart validates current availability; drawer shows free-shipping progress using the cheapest active method's `free_over`.
**3.3 Merge on sign-in:** if guest cart exists → upsert its lines into the user cart (sum quantities, cap 20), mark guest cart `converted`, clear cookie. Idempotent.
**3.4 Abandonment:** carts untouched 14 days → cron marks `abandoned` (data for future win-back emails; no emails v1).

## 4. Checkout flow

1. Client validates form (Zod) → `placeOrder` server action.
2. Action: rate-limit → resolve cart (auth: user cart; guest: cookie token via admin client) → re-validate payload → call `checkout_create_order` RPC (user client for authed, admin client for guests).
3. RPC (atomic, docs/03 §8): locks cart + stock rows, prices from DB, validates coupon, computes totals, creates order/items/payment, decrements stock + ledger, redeems coupon, converts cart.
4. Post-RPC by provider: **cod** → send order-confirmation email, redirect to success page. **bank_pos** → create provider session (adapter §6.3), redirect to bank page; order stays `pending/payment pending` until webhook.
5. Errors surface as coded messages: `OUT_OF_STOCK:<sku>` (refresh cart, name item), `COUPON_*`, `CART_EMPTY`, generic fallback. Converted carts cannot re-submit (double-click safe).
   Guest email matching an existing account: allowed (order links by email for lookup; not attached to the account). Post-purchase account creation (guest opt-in) uses Supabase invite → password set; past guest orders with that email are then attached by a service task (match on email, one-time).

## 5. Tax & invoices

VAT-inclusive pricing (B2C norm). Order stores informational `tax_cents`; success page, emails, and the print invoice show "Includes VAT (18%): €x.xx". Invoice v1 = print-styled order page (customer + admin); fiscal/e-invoice integration is a Phase-2 item — flag before launch if fiscalization applies to the entity.

## 6. Payments — provider abstraction (`src/lib/payments/`)

```ts
export interface PaymentProvider {
  key: 'cod' | 'bank_pos' | 'stripe';
  createPayment(order: OrderForPayment): Promise<
    | { kind: 'immediate' } // COD: nothing to do
    | { kind: 'redirect'; url: string } // hosted payment page
  >;
  handleWebhook(
    req: Request,
  ): Promise<{ orderId: string; result: 'paid' | 'failed'; providerRef?: string; raw: unknown }>;
  refund?(payment: PaymentRow, amountCents: number): Promise<{ ok: boolean; providerRef?: string }>;
}
```

**6.1 COD (v1, complete):** `createPayment` → immediate. Payment stays `pending`; flips to `paid` automatically when order → `delivered` (DB trigger). Refunds for COD are operational (cash/bank transfer) — recorded via `createRefund`, no provider call.
**6.2 Order/payment status matrix:** order `pending` + payment `pending` (COD until delivery, card until webhook) → card webhook `paid` auto-advances order to `confirmed`; webhook `failed` → payment `failed`, order stays `pending` with retry-payment link (email) valid 24 h, then auto-cancel by cron.
**6.3 Bank virtual POS adapter (implement when contracted):** Kosovo acquirers use a hosted-page pattern (form/redirect with merchant ID + amount + signed hash → customer pays → server-to-server callback + browser return URL). Adapter tasks: build signed request per bank spec, `handleWebhook` verifies signature, matches `provider_ref`, is idempotent (unique index on `payments.provider_ref`), updates payment+order, emails confirmation. Route: `/api/webhooks/payments/bank_pos`. Config via `BANK_POS_*` env. Until enabled, the checkout option is hidden (`settings.checkout.bank_pos_enabled=false`).
**6.4 Stripe adapter (future, EU entity/diaspora):** same interface via Checkout Sessions + webhook; do not build in v1, do not block it either.

## 7. Order lifecycle

**7.1 State machine** (DB-enforced, docs/03 §8): pending → confirmed → processing → shipped → delivered; cancel allowed from pending/confirmed/processing; refunded from shipped/delivered (via refund flow).
**7.2 Side effects (trigger + actions):** confirmed → email; shipped ← creating a shipment prompts transition + tracking email; delivered → COD payment `paid`, loyalty earn, review-request email queued (+7 d cron); cancelled → auto-restock + email; every change → order_event.
**7.3 Refunds:** support enters amount (≤ paid) + reason + restock flag. Full refund → payment `refunded`, order `refunded`; partial → payment `partially_refunded`, order status unchanged. Restock flag inserts `refund_restock` movements for selected quantities (v1: all items when full refund; partial refunds don't restock unless toggled with qty prompt — keep simple: full-refund restock only, note for partial). Customer email states method (cash/bank transfer for COD).
**7.4 Customer cancel:** allowed while `pending` via account (`requestCancelOrder` → sets cancelled directly); afterwards → contact support CTA.

## 8. Subscriptions (COD-era model: scheduled repeat orders)

**8.1 Create:** PDP SubscribeToggle marks the cart line `subscribe` intent (cart metadata v1: simplest — checkout creates the order normally, then for intent lines creates/merges a subscription with chosen frequency, address, method, provider; confirmation email explains it). Frequencies 30/45/60/90 d; default discount 10% (settings) applied to subscription-generated orders' items (RPC is not reused — see 8.2).
**8.2 Renewal engine (cron daily 06:00 CET → `/api/cron/subscriptions`, CRON_SECRET-guarded):**

- T−3 days (`notice_days`): email "Your delivery is being prepared" with one-click skip (+1 cycle) / pause / edit links (signed, expiring tokens).
- Due date: for each `active` sub with `next_run_at ≤ today`: service client builds a temp cart from `subscription_items`, calls the checkout RPC (address/method/provider from the sub), then applies the subscription discount by adjusting the created order (v1 simplification: pass discount as an internal coupon `SUB-<pct>` maintained by system, hidden `is_active`, unlimited — cleaner than order surgery), links `orders.subscription_id`, advances `next_run_at += frequency`, emails confirmation.
- Out-of-stock item: skip that line, note in email; entire cart empty → skip cycle + email.
- Failures: logged, retried next run; 3 consecutive failures → pause + email + admin queue.
  **8.3 Controls:** skip next (next_run_at += frequency), pause (status paused + optional `paused_until`; cron auto-resumes), change frequency/items/address, cancel (reason). All customer-side actions instant, no penalties. Copy is explicit that payment is on delivery (until card saved-payment exists).

## 9. Coupons, loyalty, offers

**Coupons:** validation only inside the RPC (prevents enumeration); one coupon per order; UI `previewCoupon` action returns projected totals using the same rules; codes case-insensitive (citext). System coupons (SUB-x, loyalty LOY-xxxx) are hidden from /offers.
**Loyalty:** earn on `delivered` (trigger): floor(€ total) × rate (default 1 pt/€). Redeem in account: 100 pts → single-use fixed coupon €5 (`redeemLoyalty` action: deduct points + ledger + create coupon `LOY-XXXXXX`, max_uses 1, 90-day expiry, shown once). Points never expire v1 (`expiry` reason reserved). Cancel/refund of an earning order: claw back via negative ledger entry in refund action (floor to available balance).
**Offers page:** driven by compare-at prices + public active coupons (docs/05 §11).

## 10. Catalog publishing & compliance workflow

draft → (PM) pending_review → (Compliance) published | back to draft with note. Editing claim-bearing fields (description, warnings, ingredients, certifications) of a **published** product flags it `pending_review` again _only_ if compliance requires (v1: soft rule — banner "changes not re-reviewed", compliance queue shows recently-edited published products). Archived products: PDP returns 410-style "no longer available" page with alternatives (relations/category), remain in past orders.

## 11. Inventory rules

Single default warehouse operates v1 (schema is multi). on_hand changes ONLY via: checkout RPC (sale −), cancel trigger (+), refund restock (+), receive (+ batch/expiry), manual adjust (±, reason). Ledger (`stock_movements`) is append-only and must always sum to on_hand (invariant test). Low-stock: `on_hand ≤ threshold` → dashboard queue; out-of-stock variants stay visible but not addable. Batch/expiry tracked on receipts for traceability (FEFO picking is operational guidance, not system-enforced v1).

## 12. Emails triggered by commerce events (templates in docs/08 §6)

order confirmation · payment failed/retry · order confirmed · shipped (tracking) · delivered · cancelled · refund issued · subscription upcoming (T−3) · subscription order created · subscription paused/resumed/cancelled · review request (delivered +7 d) · guest account invite. Every send logged to `email_log`; failures don't block the commerce transaction (fire-and-forget with Sentry capture).
