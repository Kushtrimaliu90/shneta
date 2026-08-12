# 06 · Admin Panel

Route root `/admin` (English UI, not localized). Shell: left sidebar (sections filtered by role per docs/01 §3), topbar (global search ⌘K: orders by number/email, products by name/SKU, customers by email; environment badge on staging), user menu. All tables = shared **DataTable**: server-driven sort/filter/keyset pagination, column visibility, CSV export (current view), empty/loading/error states. **Every mutation writes `audit_logs`** (helper `audit(action, entity, before, after)`), re-checks role server-side, and calls `revalidatePublic()` when it touches public content. Destructive actions require a typed-confirmation dialog. Access: middleware + layout guard (docs/02 §8) + RLS.

## 1. Dashboard — `/admin` (all staff; cards filtered by role)

KPI row (today / 7d / 30d with delta): revenue, orders, AOV, new customers, active subscriptions. Charts (recharts): revenue by day (30d, from `v_admin_daily_sales`), orders by status donut. Action queues: **orders awaiting confirmation** (pending, oldest first), **low stock** (`v_low_stock`), **reviews pending**, **products pending compliance review**, **new contact messages**. Each queue links to the filtered list. Acceptance: loads < 1 s on seed data; numbers reconcile with orders table.

## 2. Orders — `/admin/orders`, `/admin/orders/[id]` (support, warehouse; refunds: support)

List: filters status/payment/provider/date-range/search(number, email, name); tabs = status counts; bulk: print packing slips (selected → print-styled page), export CSV.
Detail — 3 columns:

- **Main:** items (image, name, SKU, qty, unit, total), totals block, customer note.
- **Side:** customer card (link → customer detail; guest badge), addresses (edit until shipped), payment card (provider, status; COD shows "collect €X"; `bank_pos` shows provider ref), shipment card (create/edit: carrier, tracking → status auto `shipped` prompt).
- **Timeline:** `order_events` full, add internal note.
  Header actions by state machine (docs/07 §7): Confirm → Process → Ship (opens shipment dialog) → Deliver; Cancel (reason; auto-restock via trigger); **Refund** dialog (amount ≤ paid total, reason, restock toggle → `createRefund` action: inserts refund, sets payment/order statuses per docs/07 §7.3, emails customer). Invalid transitions are disabled with tooltip. Buttons trigger the matching customer email (docs/08 §6) — shown as toggle "notify customer" (default on). Acceptance: every transition covered by an integration test; refund cannot exceed paid amount.

## 3. Products — `/admin/products`, `/new`, `/[id]` (product_manager; compliance for approval)

List: search name/SKU/brand; filters status/brand/category/stock; badge column stock health. Row actions: edit, duplicate, archive.
Editor — header (name, StatusBadge, Save, and **status control**: Draft → Submit for review → (compliance) Approve & publish / Reject with note; publish blocked until compliance approval per docs/07 §10) + tabs:

1. **General:** name/subtitle/description/how-to-use/warnings — each field with sq/en tab pair (missing-locale indicator); brand select; categories multi (mark primary); goals multi; form; serving size; dietary tags; featured toggle; slug (locked after publish).
2. **Variants & pricing:** table CRUD — sku, name(sq/en), options, price €, compare-at €, cost € (role-gated display), weight, barcode, active, default (exactly one). Money inputs in euros, stored cents.
3. **Ingredients & label:** ordered rows — ingredient (searchable select, quick-create), amount, unit, %NRV, per-serving; live IngredientTable preview.
4. **Media:** drag-drop upload to `product-images` (client → signed upload), reorder, alt sq/en, delete.
5. **SEO:** title/description per locale (counter), OG preview.
6. **Compliance:** certifications multi; lab reports upload (private bucket) + is_public toggle; approval history (approved_by/at); compliance notes.
   Acceptance: publish requires ≥1 active variant, ≥1 image, primary category, compliance approval; editing published product revalidates its tags.

**Edit in Excel** (list page, collapsed panel): download the whole catalogue as `.xlsx` — a Products sheet
(27 columns), a Variants sheet (8), and a sheet explaining the rules — edit it, upload it back. Uploading
shows a field-level diff and writes nothing until confirmed; preview and apply are the same function called
twice with the same file, so there is no posted plan and no second implementation of the rules. A column
deleted from the file is left alone; a cell emptied in a column that is still there is cleared. A file may
**not** publish a product, change the slug of a published one, or create products/variants — each refusal
names the page to use instead. Prices are compared as amounts, so an untouched round trip is a no-op.
Per-cell rules and their messages live in `src/features/catalog/sheet-cells.ts`; see docs/13 §AN.

## 4. Categories `/admin/categories` (PM): tree view with drag-reorder + reparent; inline create; edit drawer (name/desc sq-en, slug, image, icon, active, SEO). Guard: cannot deactivate category with published products (warn + list).

## 5. Brands `/admin/brands` (PM): list + editor (name, slug, logo/banner upload, description sq/en, country, website, active, SEO).

## 6. Ingredients `/admin/ingredients` (content/PM): list with evidence + usage count; editor: names/other names, summary/benefits/dosage/safety (sq/en), evidence level, category, SEO. Delete blocked while referenced.

## 7. Health goals `/admin/goals` (content): reorder tiles, editor (name/tagline/description sq-en, icon, image, active, SEO).

## 8. Inventory — `/admin/inventory`, `/movements` (warehouse, PM)

Stock table: variant (product, SKU), warehouse, on-hand, threshold (inline edit), status chip (ok/low/out); filter low/out; search SKU. Actions: **Receive stock** dialog (variant, qty, batch number, expiry, note → `receiveStock`: movement `received` + increment), **Adjust** dialog (±qty, reason mandatory → `adjustStock`). Movements page: full ledger, filter by variant/type/date, export. Order queue view (status confirmed/processing) with print packing slips. Acceptance: on-hand always equals ledger sum in tests; negative adjustments cannot take on-hand < 0.

## 9. Customers — `/admin/customers`, `/[id]` (support)

List: search email/name/phone; columns orders count, lifetime value, points, joined. Detail: profile info, addresses, order history, subscriptions, loyalty ledger (+ manual adjustment with note → `adjustLoyalty`), internal notes (order_events-like table? use `audit_logs` note action), GDPR actions: export data (JSON download), anonymize (admin only; confirms; keeps order rows, scrubs PII). No password access ever.

## 10. Reviews — `/admin/reviews` (support/content)

Moderation queue: tabs pending/approved/rejected; card shows product, author, rating, text, verified badge; actions approve / reject (reason → shown to customer) / reply (public admin_reply). Bulk approve. Acceptance: approval updates product rating aggregates (trigger) and revalidates PDP.

## 11. Coupons — `/admin/coupons` (admin create; support view)

List with usage stats (redemptions/max). Editor: code (generate button), type, value, min subtotal, limits, window, active, note. Deactivate ≠ delete once redeemed.

## 12. Subscriptions — `/admin/subscriptions` (support)

List: customer, items, frequency, next run, status, orders generated; filters. Detail: edit next_run_at, pause/resume/cancel on behalf (reason), view generated orders. Cron health widget: last run time + failures (from `email_log`/cron log — see docs/10 §6).

## 13. Content — `/admin/content/*` (content_manager)

- **Articles** list (type/status filters) + editor: title/excerpt/body markdown per locale with side-by-side preview, cover upload, type, tags, related products/ingredients/goals pickers, SEO, status Draft→In review→Published (published requires both? **sq required, en optional**), schedule publish (published_at future → cron flips? v1: manual).
- **Pages:** fixed slugs list (about, terms, privacy, shipping-returns) + markdown editor.
- **FAQs:** grouped list, drag order, inline edit sq/en.
- **Banners:** per placement; image, copy sq/en, CTA, window, order, active; live preview.

## 14. Compliance — `/admin/compliance` (compliance_manager)

Queue: products `pending_review` with diff-view of claim-bearing fields (description, warnings, ingredients); Approve & publish / Reject with note (notifies PM). Registries: certifications CRUD; lab reports across products (expiring-soon filter). Claim-language linter v1 = checklist reminder panel (docs/08 §7), automated flagging later.

## 15. Settings — `/admin/settings/*` (admin)

- **Store:** name, contact email/phone, address, socials, announcement default.
- **Shipping:** shipping_methods CRUD (name sq/en, price, free-over, ETA days, countries, active, order).
- **Payments:** toggles cod_enabled / bank_pos_enabled (+ credentials status readout — values live in env, page shows presence only).
- **Tax:** VAT rate, "prices include VAT" (locked on, informational).
- **Loyalty & subscriptions:** earn rate, redeem block, notice days, default discount.
- **Team:** staff list, invite by email (creates auth user via service + role), change role, deactivate. All audited.
- **Audit log:** `/admin/settings/audit` — filter by actor/entity/date, diff viewer.

## 16. Admin quality bar

Keyboard: ⌘K search, table row focus + enter to open. Autosave drafts where editors are long (products, articles) with dirty-state guard on navigation. All uploads validated (type/size) client+server. Timezone display: Europe/Belgrade with UTC on hover.

## 17. BioHack — `/admin/biohack` (product_manager builds, compliance_manager approves)

Six tabs behind `?tab=`, all operating on **one version**: the newest draft or pending version if
one exists, otherwise the approved one. Start a draft and every tab shows the draft, including the
simulator.

| Tab           | What it does                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Simulator** | Any goal combination + refinements → instant generation, full raw trace. Config and catalogue are shipped to the browser and the pure engine runs there, so changing an answer costs no round trip. **No writes.** |
| **Matrix**    | Per goal, the ranked blocks. Weight, core, phase, timing, active, and sq/en PSE + caution copy. Banned verbs are **rejected on save**, both locales (docs/13 §T10) |
| **Conflicts** | The pair/goal rules: `exclude`, `timing_rule` (allowed slots), `caution` (note, separate slots)                                                              |
| **Settings**  | `settings.biohack_engine` — item caps, max goals, duration, budget tiers, the per-goal core guarantee. Not versioned: these are operational dials, not copy compliance signs |
| **Versions**  | Every version with its status. "Start a new draft" copies the approved one; draft → **Send for approval** → compliance **Approve** or **Send back**          |
| **Analytics** | Generations, last 7 days, signed-in share, top goal combinations, per day. Two metrics docs/15 §4 asks for are absent and say so on the card — neither is recorded yet |

**Capabilities.** `biohack.view` (product_manager + compliance_manager) opens the screen;
`biohack.manage` (product_manager) is every mutation; `compliance.approve` is approval. Split
because both roles need the screen and neither should have the other's power — compliance must see
the draft to sign it, and must not be able to edit what they are signing.

**Immutability.** Only a `draft` can be edited, enforced per statement rather than per screen: a
stale tab pointing at a version that has since been submitted writes nothing. An approved config is
the record of what compliance signed.

**Acceptance:** an approved version offers no editing affordance; approving archives the previous
version in the same action and purges `biohack-config` so the storefront switches immediately;
`one_approved_protocol_config` makes two approved versions impossible at the database level.

### 17.1 Profile tab (docs/15 §9)

Where personalisation lives. Each row reads *for this kind of person, do this to this ingredient*,
and the tab exists so the product manager who understands the nutrition can read and change it — the
alternative was an `if` in the engine that nobody outside the repository could see.

| Column   | What it holds                                                                                |
| -------- | -------------------------------------------------------------------------------------------- |
| Order    | Rules apply in `sort_order`, then by id, so the same profile always produces the same result   |
| Target   | One ingredient, or every candidate                                                            |
| Effect   | Score change (−100…100), remove, guarantee a place, or show the body-weight serving note      |
| When     | Any combination of age / sex / weight / height / activity bands and chosen goals              |
| Reason   | Required, both locales — the sentence the customer reads. Banned verbs rejected on save        |

Two things the screen does that a tidier editor would not, both deliberate:

- **It prints the raw stored jsonb** beside the human summary. The engine narrows `when` and
  `effect` on the way out and silently drops what it does not recognise, so a rule can read as
  active here and match nobody at runtime. Seeing what is stored is the only way to catch that.
- **It flags a rule with no condition** as "matches everybody" and a rule with no effect as "does
  nothing". The first is occasionally intended; the second never is, and is refused on save.

**Acceptance:** an empty effect cannot be saved; a demotion cannot push a score below 1; starting a
draft copies the profile rules along with the blocks and conflicts (a draft that silently lost them
would take all of them live as deleted on approval); and the Simulator tab carries the same five
bands with "—" for unanswered, so an editor can reproduce a customer who skipped the step and see
the rules-fired count drop.
