# 14 · Launch Readiness Ledger

Honest status against the launch checklist in `docs/10 §9` and the milestones in `docs/12`.

**Bottom line: it is a store. A guest can buy something, end to end, and pay cash on
delivery.** Add to cart → four-step checkout → order placed by the `checkout_create_order`
transaction → gated success page → track it later with the order number and email. Verified
against the live database by 272 Playwright tests across desktop and a 390 px viewport.

**It can also now fulfil what it sells.** Support signs in, works a queue, confirms, ships with
tracking, delivers, cancels with a reason and refunds — every mutation audited, every transition
enforced by the database. Journey 7 walks the whole path in a browser on each run.

**And it can now be stocked with a real catalogue.** A product manager creates a product, fills
six tabs, uploads images, submits it; compliance reads the claims in both languages and approves;
the storefront serves it on the next request. Brands, categories, health goals and ingredients
are all editable in the panel. Nothing needs SQL any more.

**And it now has something to read.** Six articles, ten FAQs, an offers page, a contact form
that reaches an inbox, and a newsletter that actually double-opts-in.

**And it can now sell the same thing twice.** A customer chooses "subscribe and save" on the
product page, and a renewal engine builds the next order on schedule — through the same
`checkout_create_order` transaction as any other order, so a renewal is priced by the code that
prices a manual purchase. Skip, pause, resume, re-cadence and cancel are all one click, from the
account or from a link in the notice email that needs no sign-in. Points accrue on delivery and
exchange for a coupon.

**What is left before a real customer: the email, and the products themselves.** Every
transactional and marketing email records `skipped_no_provider` until a Resend key and a
verified sending domain exist (§6) — the newsletter now depends on that to complete a
subscription, not just to say thank you. And the shop still sells 24 demo fixtures until
somebody enters the real ones.

Legend: ✅ done and verified · 🟡 partial · ⬜ not started · ➖ not applicable yet

---

## 1 · Infrastructure and pipeline

| Item                                                  | State | Evidence                                                                                                          |
| ----------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| Next.js app builds for production                     | ✅    | `pnpm build`, 68 routes, no warnings                                                                              |
| First Load JS within the 170 kB budget (`docs/09 §3`) | ✅    | 120–138 kB per route, enforced by `check:bundle`                                                                  |
| Database schema applied                               | ✅    | 18 migrations on `rszbpdgfvyofvmuishmn`, Postgres 17.6                                                            |
| RLS enabled on every public table (`docs/10 §4`)      | ✅    | `tables_without_rls()` → `[]`                                                                                     |
| Integration suite against a real database             | ✅    | **57/57**, ~81 s                                                                                                  |
| Unit suite                                            | ✅    | **117/117**                                                                                                       |
| E2E + axe on both locales                             | ✅    | **272/272**, repeatable; zero serious/critical violations on cart, checkout, account, admin and the content pages |
| Generated DB types match the live schema              | ✅    | `db:types:linked` → 3043 lines, `pnpm verify` green                                                               |
| CI pipeline (quality · integration+E2E · audit)       | ✅    | `.github/workflows/ci.yml`                                                                                        |
| Security headers (`docs/10 §5`)                       | ✅    | asserted by an E2E test                                                                                           |
| `/api/health` for uptime monitoring (`docs/10 §6`)    | ✅    | returns `{status:"ok",database:"ok"}`                                                                             |
| Sitemap + robots with hreflang (`docs/08 §4`)         | ✅    | 176 URLs, 352 hreflang links                                                                                      |
| Two crons, `CRON_SECRET`-guarded                      | ✅    | housekeeping 03:30, subscription renewals 05:00; both 401 unauthenticated, 200 with token                         |
| On-demand ISR purge, secret-guarded                   | ✅    | rejects unknown tags, 401 unauthenticated                                                                         |
| Sentry server + edge                                  | ✅    | inert without a DSN; client SDK lazy-loaded                                                                       |
| `vercel.json` — region `fra1`, crons                  | ✅    |                                                                                                                   |
| Vercel project + domain + DNS                         | ⬜    | **owner task** (`docs/00`)                                                                                        |
| Resend domain verified (SPF/DKIM/DMARC)               | ⬜    | **owner task** — until then customers get no order receipt                                                        |
| Supabase staging + production projects                | ➖    | **owner decision (§7)** — one project serves all three roles                                                      |
| PITR / backups on production                          | ⬜    | **owner task**, `docs/10 §4`. More urgent under §7: no second database to fall back on                            |
| Destructive suites gated on `SUPABASE_TEST_PROJECT`   | ✅    | integration, E2E and the purge all refuse an undeclared target (§7)                                               |
| Uptime monitor pointed at `/api/health`               | ⬜    | **owner task**                                                                                                    |
| Restore drill                                         | ⬜    | `docs/10 §7`                                                                                                      |

## 2 · Product — selling, fulfilling and stocking all work; the shop floor is still fixtures

| Milestone                                    | State | What it means is missing                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0 · Scaffold                                | ✅    | —                                                                                                                                                                                                                                                                                                                                          |
| M1 · Database and seed                       | ✅    | Schema + 24-product catalogue live. `scripts/seed-users.ts` and review fixtures outstanding                                                                                                                                                                                                                                                |
| M2 · Auth and account shell                  | ✅    | Sign up / in / out, password reset, account overview and settings                                                                                                                                                                                                                                                                          |
| M3 · Catalog browse                          | ✅    | PLP, category, PDP, home, brands, goals, ingredients and SEO. The two outstanding pages, `/knowledge` and `/offers`, landed with M8                                                                                                                                                                                                        |
| M4 · Cart and COD checkout                   | ✅    | Guest cart, cart page, 4-step checkout, gated success page, order lookup. Confirmation email needs Resend (§6)                                                                                                                                                                                                                             |
| M5 · Orders ops and admin core               | ✅    | Admin shell, order queue + detail, full state machine, shipment, refund, lifecycle emails, dashboard, print docs, customer order pages                                                                                                                                                                                                     |
| M6 · Admin catalog management                | ✅    | Create → edit → variants → label → media → SEO → submit → approve → live (journey 8). All six editor tabs, brands/categories/goals/ingredients admin, brand-logo upload, the compliance queue. Cache tags on every catalogue read (docs/13 §K1). Deferred and listed below: drag-reorder, lab reports, taxonomy SEO, unsaved-changes guard |
| M7 · Reviews, wishlist, search, compare      | ✅    | Verified-purchase reviews with moderation, helpful votes and a delivered+7d request email; wishlist end to end; instant search overlay + `/search`; compare up to four. Deferred: an Articles tab (needs M8) and the review-request email needs Resend (§6)                                                                                |     |
| M8 · Knowledge, offers, contact, newsletter  | ✅    | Knowledge Center on a sanitised markdown pipeline, offers with claimable codes, contact form + admin inbox, newsletter double opt-in with a token unsubscribe, FAQ with JSON-LD, `/about` and the legal pages, cookie consent gating analytics. Six articles and ten FAQs seeded. Every email still needs Resend (§6)                      |
| M9 · Subscriptions and loyalty               | ✅    | Subscribe-and-save on the PDP; a renewal engine whose idempotency is one SQL statement (docs/13 §O1); skip, pause, resume, re-cadence and cancel from the account or from a token link needing no session; points on delivery and a redeem-for-coupon exchange; a read-only admin schedule with a cron health widget. Deferred below       |
| M10 · Inventory ops, finder, remaining admin | ⬜    |                                                                                                                                                                                                                                                                                                                                            |
| M11 · Hardening and launch                   | 🟡    | The ops half is done (this table §1). Performance, security and soak passes need the real product first                                                                                                                                                                                                                                    |

## 3 · Compliance and legal — must clear before any real customer

| Item                                                        | State | Note                                                                                                                                                           |
| ----------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplement disclaimer on required surfaces (`docs/08 §7.3`) | ✅    | Footer, PDP, ingredient and goal pages, asserted in E2E                                                                                                        |
| Terms, privacy, shipping/returns                            | 🟡    | Seeded as `[LEGAL: review]` placeholders — **must be written and legally reviewed**. Checkout now makes customers accept them, so this is on the critical path |
| Cookie/analytics consent banner (`docs/01 §4`)              | ✅    | Shipped with M8 and gates `lib/analytics.ts`, which is still a no-op — so nothing is collected with or without consent until a provider is chosen (§11)        |
| Claim-language review (`docs/08 §7`)                        | 🟡    | 24 seeded products and 20 ingredients written inside the permissible-function wording of `docs/08 §7.2`; needs a human pass before launch                      |
| Health-goal intros                                          | 🟡    | 16 goals seeded with `[CONTENT: replace]`; `docs/05 §5` requires 150+ unique words each                                                                        |
| Brand assets                                                | 🟡    | Real brand names used as fixtures with **placeholder logos** — replace with authorised assets before prod (`docs/11 §5`)                                       |

## 4 · Deploying the shell now

Safe and useful — it proves DNS, env, headers, ISR, cron auth and monitoring before any
feature depends on them. Follow `runbooks/deploy.md`.

Two things to set deliberately:

1. **`robots.txt` follows `NEXT_PUBLIC_SITE_URL`.** On a staging domain, either password-protect
   the deployment (Vercel Protection) or the shell can be indexed — a half-built store in
   Google is worse than no store.
2. **Do not point production at `rszbpdgfvyofvmuishmn`.** It is the disposable dev project
   and the integration suite writes to whatever `.env.local` targets. Production needs its
   own Supabase project.

## 5 · The next decision

M10 — inventory ops, the routine finder and the remaining admin screens. It is the last
milestone that adds features; M11 is hardening.

It is also where three earlier deferrals come due at once, which is the argument for taking it
next rather than jumping to the hardening pass: `/account/addresses` (§10), the certifications
registry (§9) and `/finder` (§11) have each been promised to M10 by a previous ledger entry, and
`/finder` has been linked from the footer since M0.

Two things remain outside any milestone and outside our control: **Resend** (§6), without which
fourteen email templates are inert and a newsletter subscription cannot complete; and the **real
catalogue** — `pnpm purge:demo` cannot run until there are real products to replace the 24
fixtures with (§7, step 2).

`docs/13 §E2` settled the Next 15 → 16 question by measurement — it stays on 15 for now.

## 6 · Owner tasks blocking the sale being _complete_

These are the ones that need an account or a domain, not code:

| Task                               | Why it blocks                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RESEND_API_KEY` + verified domain | **Deferred by the owner (2026-07-31).** The order-confirmation email is written, templated in both locales and wired into `placeOrder`; without the key `lib/email/send.ts` records `skipped_no_provider` and no-ops. Nothing breaks — but **customers get no receipt**, which for a cash-on-delivery shop in a new market is the main trust signal at the moment of purchase. Reversible at any time by adding the key; needs SPF, DKIM and DMARC on the sending domain |
| Vercel project + domain + DNS      | `runbooks/deploy.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Legal copy for terms and privacy   | Checkout requires customers to accept them; they are currently `[LEGAL: review]` placeholders                                                                                                                                                                                                                                                                                                                                                                            |

---

## 7 · One Supabase project for dev, test and production

The owner decided on **2026-07-31** that `rszbpdgfvyofvmuishmn` serves all three roles rather
than creating a separate production project. This section exists because that choice moves
three risks from "impossible by construction" to "prevented by a guard", and a guard is only
as good as the checklist that keeps it in place.

### What was changed to make it survivable

**A fail-closed declaration.** `SUPABASE_TEST_PROJECT` must be set and must equal the project
ref in `NEXT_PUBLIC_SUPABASE_URL`, or the integration suite, the E2E suite and the fixture
purge all refuse to start. Not a boolean — a ref, so it stops matching the moment the target
changes, whereas `ALLOW=1` in a shell profile would follow you anywhere. `127.0.0.1` is exempt,
being disposable by definition.

The guard it replaced refused a list of `shneta.com` hostnames, which could never have fired:
a Supabase database is at `<ref>.supabase.co`, never at the site's hostname. It was written
assuming dev and prod were different projects and protected nothing once they were not.

**The one unscoped deletion, scoped.** `purgeFixtures` deleted every guest cart
(`user_id is null`) with no fixture filter — on a live shop, every anonymous basket, every
test run, silently. It is now limited to _empty_ guest carts, which costs nobody anything:
`ensureCart()` mints a new one when a token stops resolving. Carts holding items are left to
the housekeeping cron's normal expiry.

**A reviewable pre-launch cleanup.** `pnpm purge:demo --dry-run` / `--yes` removes the 24
fixture products, 20 fixture ingredients and 4 test coupons. It refuses to delete a fixture
product that has been ordered, because `order_items.variant_id` is `on delete set null` and
deleting it would destroy the link from the order to what was sold.

### Launch checklist — every line is blocking

| #   | Do this                                              | Why                                                                                                                                                                                 |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Enter the real catalogue (needs M6's product editor) | The storefront currently sells fixtures                                                                                                                                             |
| 2   | `pnpm purge:demo --dry-run`, read it, then `--yes`   | 24 fake products with real brand names and unlicensed logos, and 3 **active** coupons. A customer can otherwise buy something that does not exist, or take 10% off with `WELCOME10` |
| 3   | **Delete `SUPABASE_TEST_PROJECT` from `.env.local`** | This single line is what stands between `pnpm test:e2e` and customer data. After removing it, both suites refuse to run against this project — which is the point                   |
| 4   | Never set `SUPABASE_TEST_PROJECT` in Vercel          | It has no purpose in a deployed environment and every purpose in a destructive one                                                                                                  |
| 5   | Enable Point-in-Time Recovery (paid add-on)          | There is no second database to fall back on. Orders, addresses and phone numbers with no restore point is not a recoverable position                                                |
| 6   | Confirm `tables_without_rls()` returns `[]`          | Cheap, and the whole security model rests on it                                                                                                                                     |

### What is permanently given up

**There is nowhere to run the destructive suites after step 3.** Docker is not installed on
the build machine, so the local stack is unavailable; the integration and E2E suites are the
acceptance gate for every remaining milestone (M5–M11). From step 3 onward, verifying a
milestone means either a second Supabase project (the free tier allows two, so a test-only
project costs nothing) or installing Docker for `supabase start`. Deferring this is fine.
Discovering it on launch day is not — which is why it is written here rather than left to be
found.

---

## 8 · The demo catalogue cannot be re-published

Migration 14 made publishing conditional on an active variant, an image, a primary category and
compliance approval (docs/06 §3). Checking the 24 seeded products against it:

    published products meeting the guard: 0 / 24
    every one is missing: image, approval

This is **not a regression** — the trigger fires on the transition _into_ published, so rows
already published stay published and the storefront is unaffected. It is the guard correctly
reporting that the fixture catalogue was never complete:

- `pnpm seed:images` (docs/11 §10) was never written, so no product has a `product_images`
  row. The storefront renders the branded fallback tile instead, which is why nobody noticed.
- The seed sets `status = 'published'` directly, without an approver, because it runs as the
  service role — which the guard exempts for exactly that reason.

**What it means in practice:** archive a seeded product and you cannot restore it to published
without adding an image and having compliance approve it. That is the correct behaviour, and it
is a preview of the real workflow.

**What it means for launch:** every real product needs an image before it can go live. That is
already implied by §7 step 1, but the guard now enforces it rather than trusting the operator to
remember — which is the right place for it.

---

## 9 · What M6 deliberately left out

The catalogue admin is complete enough to enter and publish a real catalogue. Six things in
docs/06 §3–§7 and §14 are not built, each for a stated reason rather than because time ran out.

| Item                                                  | Why it is not here                                                                                                                                                                                                                                 | When                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Drag-reorder for the category tree and goal tiles     | Ships as a `sort_order` number and a "sits inside" select. Works without JavaScript, unambiguous over a hierarchy, and replaceable later without a schema change (docs/13 §L5)                                                                     | Any time; no data change                                 |
| Lab report upload (`lab-reports`, private bucket)     | No storefront component renders a certificate of analysis yet. An uploader for a document no customer can reach has no observable effect — the same class of defect as a cache purge with no tag (docs/13 §L4)                                     | With docs/05 §3's PDP section                            |
| `seo` jsonb on brands, categories, goals, ingredients | Nothing reads it. Product SEO shipped **with** its reader in `generateMetadata`; taxonomy SEO would be a writer alone                                                                                                                              | With docs/08 §4                                          |
| Certifications registry CRUD (docs/06 §14)            | The product editor can attach existing certifications, which is what publishing needs. Creating them is a once-a-quarter act better done with a migration than a screen                                                                            | M10, with the remaining admin                            |
| Approve-without-publish from the queue                | The action supports it, but it leaves the product at `pending_review`, so the item would stay in a queue with no sign it was handled. Needs an "approved, awaiting launch" status the schema does not have (docs/13 §L3)                           | With docs/07 §10                                         |
| Unsaved-changes guard on the editor (docs/06 §16)     | Each tab is its own form posting its own action, so switching tabs with unsaved edits loses them. Known, and called out at the top of `product-editor.tsx`                                                                                         | M11 hardening                                            |
| Variant `options`, `weight_grams`, `barcode`, cost    | The six tabs are all present; four **fields** inside Variants are not. `options` is fetched but never rendered — the BuyBox labels a variant by its name — and the other three have no reader at all yet (flat-rate shipping, no margin reporting) | Cost with M10; the rest with the feature that reads them |

Two carried over from earlier milestones and still outstanding: `pnpm seed:images` (§8), and the
in-app notification a rejected product manager should get instead of being told in person
(docs/06 §14 — the note currently lives only in `audit_logs`).

---

## 10 · What M7 deliberately left out, and one thing to fix first

### The one to fix first

**The storefront is not statically rendered, and has not been since M4** (docs/13 §M1).
`Navbar` reads the cart cookie, the navbar is in the layout, and a request-scoped API in a layout
makes every page beneath it dynamic. The Data Cache and tag purging work correctly — that half is
real — but every catalogue visit re-runs a React render that could have been a file.

The fix is one component: make the cart badge fetch its count after mount, as the wishlist
provider now does. It belongs in M11's performance pass and it is the highest-value item in it.

### Deferred from M7

| Item                                     | Why it is not here                                                                                                                                                                    | When            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Articles tab in search (docs/05 §8)      | `/knowledge/[slug]` arrives with M8, so an article result today is a link to a 404. Ingredients take the slot (docs/13 §M4)                                                           | M8              |
| Review-request email actually sending    | The cron step, the query and the template are built and wired. Like every other email it records `skipped_no_provider` until Resend has a verified domain (§6)                        | Owner task (§6) |
| Q&A on the PDP                           | docs/05 §3 marks it "v2 placeholder hidden", and it is hidden                                                                                                                         | v2              |
| "Frequently bought together" / "Similar" | `product_relations` exists and is unpopulated; a recommendations strip built on an empty table shows nothing and looks broken                                                         | With seed data  |
| Add-to-cart from the comparison table    | docs/05 §9 sketches it in the header row, but a multi-variant product cannot be added without asking which one — and the visitor is comparing precisely because they have not decided | Not planned     |
| `/account/addresses`                     | Named in docs/05 §14 and marked **M5** in the account nav, which shipped without it. Not an M7 regression, but the nav badge now claims a milestone that is complete                  | M10             |

### What M7 changed about testing

`e2e/helpers/accounts.ts` now owns test users, the service client and the sign-in helper, which
`admin.spec.ts` used to. Two new spec files came with it — `reviews.spec.ts` (journey 6) and
`discovery.spec.ts` (journey 10) — each with its own reserved documentation IP block, because
sign-in is rate-limited per address and two files sharing a block is a failure that looks like a
broken feature. The allocation is written down in that helper.

---

## 11 · What M8 deliberately left out

| Item                                   | Why it is not here                                                                                                                                                                                                          | When               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| An analytics provider                  | The consent banner is real and gates correctly; `lib/analytics.ts` is a no-op. docs/10 never picks between Plausible, Umami and GA4, and the choice changes the snippet, the event API and the privacy notice (docs/13 §N6) | Owner decision     |
| `/admin/content/*` (docs/06 §13)       | Articles, pages, FAQs and banners are all editable **by migration and seed**, not in the panel. Six articles is a launch's worth; a CMS for them is a milestone of its own                                                  | M10                |
| Replying to a contact message in-panel | The inbox records that a reply was sent; the reply goes from the operator's own mail client. A second outbound identity is a deliverability problem, and a mailbox threads better (docs/13 §N5)                             | Not planned        |
| Article cover images                   | `pnpm seed:images` is still outstanding (§8), so every article renders the tinted type placeholder. The upload path exists in the `content` bucket; nothing writes to it yet                                                | With `seed:images` |
| `/finder` (footer link)                | docs/12 puts the quiz in M10. The footer has linked to it since M0                                                                                                                                                          | M10                |

### The emails M8 added, all waiting on Resend

`contact_ack`, `newsletter_confirm`, `newsletter_welcome`, plus M7's `review_request`. All four
are wired, logged and asserted by tests through `email_log` — they record `skipped_no_provider`
and will start sending the moment a key and a verified domain exist.

**One of them is now load-bearing**, which is new: a newsletter subscription cannot be completed
without the confirmation email arriving. Until Resend is configured, `newsletter_subscribers`
collects rows that can never confirm themselves. They are not lost — the token is stored, and the
first thing to do after wiring Resend is to mail everyone whose `confirmed_at` is still null.

---

## 12 · What M9 deliberately left out

| Item                                             | Why it is not here                                                                                                                                                                                                                                                                                 | When                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Pause / cancel / reschedule from the admin panel | docs/06 §12 asks for them. Each already exists as a customer action, so doing it from the panel is support acting **as** a customer — which needs an impersonation story the audit log can express. Improvising one makes staff and customer actions indistinguishable in the record (docs/13 §O6) | M10, with docs/06 §15's audit work |
| Changing a subscription's items from the panel   | Same reason, plus a worse failure mode: an operator adding an item silently changes what the customer is billed on delivery                                                                                                                                                                        | With the above                     |
| Card-on-file / recurring payment                 | docs/07 §6 has one provider and it is cash on delivery. A subscription here is a scheduled COD order, and the account page says so in as many words rather than letting the customer assume a card is being charged                                                                                | With a real PSP                    |
| Loyalty tiers (docs/07 §9.4)                     | Points earn and redeem; tiers change the earn **rate**, and a rate that varies by tier needs the tier boundaries to be a decision somebody has made. Ours would be invented numbers on a launch with no customers                                                                                  | Post-launch                        |
| Points for reviews, referrals and birthdays      | docs/07 §9.2 lists four earn events; only "order delivered" is wired. The other three each need an anti-abuse rule (a review written to farm points is worse than no review) and none of them is worth writing before there is traffic to abuse it                                                 | Post-launch                        |
| A cron run table behind the admin health widget  | The widget reads `email_log`, which is a proxy for "the engine ran and had something to do". A table whose only reader is one dashboard is a schema for a dashboard, and the copy is honest about the proxy rather than crying wolf on a quiet week                                                | If it misleads once                |
| Prorating a mid-cycle cadence change             | Changing frequency leaves `next_run_at` alone: the customer asked for "and every N days **after that**". Recomputing would pull a delivery forward or push it back, neither of which they asked for                                                                                                | Not planned                        |

### The emails M9 added, all waiting on Resend

`subscription_notice`, `subscription_order`, `subscription_skipped` and
`subscription_paused` — bringing the total waiting on §6 to **fourteen templates**:
`order-confirmation`, the five order-lifecycle mails, `review_request`, `contact_ack`,
`newsletter_confirm`, `newsletter_welcome` and these four.

One is load-bearing in a way worth stating: `subscription_notice` is what carries the
one-click skip link three days before a delivery. Until Resend is configured, a customer's only
way to skip is to sign in and use the account page. The renewal engine itself does not depend on
it — orders will still be built and still be delivered — so **the first subscription created on a
production without Resend is a repeat order the customer cannot conveniently stop.** Configure
Resend before enabling subscribe-and-save for real customers, or accept support calls instead.

### What M9 changed about the schedule

Two crons now run, and the second one **spends money**: `/api/cron/subscriptions` at 05:00 CET
builds real orders against real stock. Three consequences for whoever operates this:

- `CRON_SECRET` is no longer only an anti-noise measure. An unauthenticated caller who could
  reach it would place orders. It is asserted 401 by an E2E test on every run.
- Invoking it by hand is safe and idempotent — that is the point of docs/13 §O1 — but it is not
  free: each invocation ships whatever is genuinely due.
- `vercel.json` schedules it 90 minutes after housekeeping so the two never overlap on one
  database.
