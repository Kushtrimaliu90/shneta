# 14 · Launch Readiness Ledger

Honest status against the launch checklist in `docs/10 §9` and the milestones in `docs/12`.

**Bottom line: it is a store. A guest can buy something, end to end, and pay cash on
delivery.** Add to cart → four-step checkout → order placed by the `checkout_create_order`
transaction → gated success page → track it later with the order number and email. Verified
against the live database by 390 Playwright tests across desktop and a 390 px viewport.

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

**And it can now be run.** Stock is received and adjusted against a ledger that cannot drift,
customers are searchable with their lifetime value, coupons are minted from the panel, articles
and FAQs and banners are edited without a migration, and an admin can invite a colleague, change
the VAT rate or add a courier and see it on the shop the next time a page renders. A visitor who
does not know what to buy can answer five questions and get a routine.

**And it has now been hardened.** The storefront is served from files again after seven
milestones of quietly re-rendering every request (docs/13 §Q1), the security pass in docs/09 §5
runs as tests rather than as a checklist somebody ticked, the dependency audit is clean, and CSP
enforcement is one environment variable away.

**And it is deployed.** `https://www.shtrejt.com` serves it, and `/api/health` reports which commit
answered — which is the only reliable way to tell whether what you are looking at is what you pushed.

**What is left before a real customer: four environment variables in Vercel, and the products.**
`RESEND_API_KEY` and `EMAIL_FROM` (set locally, unverified in the deployment — until both exist every
template records `skipped_no_provider` and a newsletter subscription cannot _complete_), `CSP_ENFORCE`
(production serves the policy report-only today), and a Sentry DSN. And the shop still sells 24 demo
fixtures with no photography until somebody enters the real ones.

**§20 is the current list**, written from an audit of the live site rather than from this preamble. The
sections above are milestone records and some of their numbers were stale by the time it was written —
which is the argument for §20 existing.

Legend: ✅ done and verified · 🟡 partial · ⬜ not started · ➖ not applicable yet

---

## 1 · Infrastructure and pipeline

| Item                                                  | State | Evidence                                                                                                          |
| ----------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| Next.js app builds for production                     | ✅    | `pnpm build`, 86 routes, no warnings                                                                              |
| First Load JS within the 170 kB budget (`docs/09 §3`) | ✅    | 120–138 kB per route, enforced by `check:bundle`                                                                  |
| Database schema applied                               | ✅    | **62** migrations on `rszbpdgfvyofvmuishmn`, Postgres 17.6                                                        |
| RLS enabled on every public table (`docs/10 §4`)      | ✅    | `tables_without_rls()` → `[]`                                                                                     |
| Integration suite against a real database             | ✅    | **478/478** — includes the docs/09 §5 attack suite and the M13 referral suites                                     |
| Unit suite                                            | ✅    | **351/351**                                                                                                       |
| E2E + axe on both locales                             | ✅    | **484/484**, repeatable; zero serious/critical violations on any asserted surface                                 |
| Generated DB types match the live schema              | ✅    | `db:types:linked` → 5111 lines, `pnpm verify` green                                                              |
| CI pipeline (quality · integration+E2E · audit)       | ✅    | `.github/workflows/ci.yml`                                                                                        |
| Security headers (`docs/10 §5`)                       | 🟡    | asserted by an E2E test. **CSP is report-only in production** — `CSP_ENFORCE` is unset (§20)                       |
| `/api/health` for uptime monitoring (`docs/10 §6`)    | ✅    | returns `{status:"ok",database:"ok",commit}` — the commit is how you tell which build answered                     |
| Sitemap + robots with hreflang (`docs/08 §4`)         | ✅    | Reciprocal sq/en alternates on every URL, and no doubled slash — both asserted (§20)                               |
| Four crons, `CRON_SECRET`-guarded                     | ✅    | housekeeping 03:30, payouts 04:15, referrals 04:45, subscription renewals 05:00; all 401 unauthenticated, 200 with token |
| On-demand ISR purge, secret-guarded                   | ✅    | rejects unknown tags, 401 unauthenticated                                                                         |
| Sentry server + edge                                  | ✅    | inert without a DSN; client SDK lazy-loaded                                                                       |
| `vercel.json` — region `fra1`, crons                  | ✅    |                                                                                                                   |
| Vercel project + domain + DNS + HTTPS                 | ✅    | **live**: `https://www.shtrejt.com/api/health` answers 200 with the deployed commit                              |
| Resend domain verified (SPF/DKIM/DMARC)               | 🟡    | `shtrejt.com` verified; `RESEND_API_KEY` and `EMAIL_FROM` are set locally. **Unverified in Vercel** — see §20    |
| Supabase staging + production projects                | ➖    | **owner decision (§7)** — one project serves all three roles                                                      |
| PITR / backups on production                          | ⬜    | **owner task**, `docs/10 §4`. More urgent under §7: no second database to fall back on                            |
| Destructive suites gated on `SUPABASE_TEST_PROJECT`   | ✅    | integration, E2E and the purge all refuse an undeclared target (§7)                                               |
| Uptime monitor pointed at `/api/health`               | ⬜    | **owner task**                                                                                                    |
| Restore drill                                         | ⬜    | **owner task** — `runbooks/restore.md` is written; the drill needs a scratch project (`docs/10 §7`)               |

## 2 · Product — selling, fulfilling and stocking all work; the shop floor is still fixtures

| Milestone                                    | State | What it means is missing                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 · Scaffold                                | ✅    | —                                                                                                                                                                                                                                                                                                                                                                             |
| M1 · Database and seed                       | ✅    | Schema + 24-product catalogue live. `scripts/seed-users.ts` and review fixtures outstanding                                                                                                                                                                                                                                                                                   |
| M2 · Auth and account shell                  | ✅    | Sign up / in / out, password reset, account overview and settings                                                                                                                                                                                                                                                                                                             |
| M3 · Catalog browse                          | ✅    | PLP, category, PDP, home, brands, goals, ingredients and SEO. The two outstanding pages, `/knowledge` and `/offers`, landed with M8                                                                                                                                                                                                                                           |
| M4 · Cart and COD checkout                   | ✅    | Guest cart, cart page, 4-step checkout, gated success page, order lookup. Confirmation email needs Resend (§6)                                                                                                                                                                                                                                                                |
| M5 · Orders ops and admin core               | ✅    | Admin shell, order queue + detail, full state machine, shipment, refund, lifecycle emails, dashboard, print docs, customer order pages                                                                                                                                                                                                                                        |
| M6 · Admin catalog management                | ✅    | Create → edit → variants → label → media → SEO → submit → approve → live (journey 8). All six editor tabs, brands/categories/goals/ingredients admin, brand-logo upload, the compliance queue. Cache tags on every catalogue read (docs/13 §K1). Deferred and listed below: drag-reorder, lab reports, taxonomy SEO, unsaved-changes guard                                    |
| M7 · Reviews, wishlist, search, compare      | ✅    | Verified-purchase reviews with moderation, helpful votes and a delivered+7d request email; wishlist end to end; instant search overlay + `/search`; compare up to four. Deferred: an Articles tab (needs M8) and the review-request email needs Resend (§6)                                                                                                                   |     |
| M8 · Knowledge, offers, contact, newsletter  | ✅    | Knowledge Center on a sanitised markdown pipeline, offers with claimable codes, contact form + admin inbox, newsletter double opt-in with a token unsubscribe, FAQ with JSON-LD, `/about` and the legal pages, cookie consent gating analytics. Six articles and ten FAQs seeded. Every email still needs Resend (§6)                                                         |
| M9 · Subscriptions and loyalty               | ✅    | Subscribe-and-save on the PDP; a renewal engine whose idempotency is one SQL statement (docs/13 §O1); skip, pause, resume, re-cadence and cancel from the account or from a token link needing no session; points on delivery and a redeem-for-coupon exchange; a read-only admin schedule with a cron health widget. Deferred below                                          |
| M10 · Inventory ops, finder, remaining admin | ✅    | Inventory with receive/adjust/thresholds and the movements ledger; customers with lifetime value, manual points and GDPR export/erasure; coupons; content (articles, pages, FAQs, banners); the settings suite including team invites and the audit log; the supplement finder. Plus three carried deferrals: `/account/addresses`, the certifications registry and `/finder` |
| M11 · Hardening and launch                   | 🟡    | **Engineering complete.** Static rendering restored (docs/13 §Q1), the docs/09 §5 security pass shipped as tests, CSP made enforceable, dependency audit clean, axe widened, runbooks written. What remains is owner-side and content-side — see §14                                                                                                                          |

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

**M11 — hardening and launch.** Every feature milestone is done; what is left is the performance
pass, the security pass, the soak and the launch checklist in docs/10 §9.

The highest-value item in it is already known and already measured: **the storefront has not been
statically rendered since M4** (§10, docs/13 §M1). One component reads the cart cookie in the
layout, and every catalogue page beneath it pays for it on every request. Nothing else in the
performance pass is worth doing first.

Two things remain outside any milestone and outside our control: **Resend** (§6), without which
fourteen email templates are inert and a newsletter subscription cannot complete; and the **real
catalogue** — `pnpm purge:demo` cannot run until there are real products to replace the 24
fixtures with (§7, step 2). Neither is an engineering task, and both block launch.

`docs/13 §E2` settled the Next 15 → 16 question by measurement — it stays on 15 for now.

## 6 · Owner tasks blocking the sale being _complete_

These are the ones that need an account or a domain, not code:

| Task                                | Why it blocks                                                                                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY` in the environment | **Half done.** `shtrejt.com` is registered and verified in Resend. What is missing is the key itself, in `.env.local` locally and in Vercel for deploys — until it is set, all fourteen templates record `skipped_no_provider` and no customer receives anything |
| Vercel project + domain + DNS       | `runbooks/deploy.md`. The domain exists now; pointing it at Vercel is the remaining step                                                                                                                                                                         |
| Legal copy for terms and privacy    | Checkout requires customers to accept them; they are currently `[LEGAL: review]` placeholders                                                                                                                                                                    |

**On the domain.** `shtrejt.com` is registered and verified in Resend, and is deliberately not
the brand name — biocode.com was unavailable, and the From: address has to sit on the domain
holding the DNS records. Three files hardcode it: `seed.sql`'s `settings.store.email`, the
invoice header, and the product editor's SEO preview. They move together or not at all.

What remains is only the key. `sendEmail` reads `RESEND_API_KEY` and `EMAIL_FROM` together and
degrades to `skipped_no_provider` if either is missing — so a half-configured environment is
silent rather than broken, which is the right behaviour and also the reason nobody will notice
the key is absent until they go looking in `email_log`.

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

The guard it replaced refused a list of `biocode.com` hostnames, which could never have fired:
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

---

## 13 · What M10 deliberately left out

| Item                                              | Why it is not here                                                                                                                                                                                                                        | When                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Side-by-side markdown preview on articles         | docs/06 §13 asks for it. It needs the sanitising pipeline (docs/13 §N3) running in the browser — shipping rehype to the client for a screen only content managers open, when the same content manager can open the article in another tab | M11, if measured cheap        |
| Article cover upload                              | The `content` bucket and the upload pattern both exist. `pnpm seed:images` (§8) is still outstanding, so every article renders the type placeholder either way — an uploader would be the only thing on the page that worked              | With `seed:images`            |
| Admin subscription edits (pause/cancel on behalf) | Carried from §12 unchanged: it is support acting **as** a customer, and needs an impersonation story the audit log can express                                                                                                            | With docs/06 §15 audit work   |
| Lab-report upload and the expiring-soon filter    | docs/06 §14 lists it beside the certifications registry, which M10 did ship. No storefront component renders a certificate of analysis yet, so the uploader would still have no reader (§9's original reasoning, still true)              | With docs/05 §3's PDP section |
| Bulk actions anywhere                             | No bulk approve, bulk price change or CSV import. Each is a different confirmation problem and none has a user yet — the catalogue is 24 products                                                                                         | When volume asks              |
| `seo` jsonb editors on taxonomy                   | Carried from §9. Still nothing reads it                                                                                                                                                                                                   | With docs/08 §4               |
| Warehouse transfers, multi-warehouse picking      | The schema is multi-warehouse (docs/07 §11) and the business is one shelf. `v_admin_inventory` shows the warehouse column so the day it stops being one shelf is visible                                                                  | When there are two            |
| An invitation email                               | docs/06 §15 says "invite by email". The account is created; no email is sent, because there is no email (§6). The new colleague uses "forgot password", and the screen says so rather than implying a mail is on its way                  | Owner task (§6)               |

### What M10 changed about the database

Two migrations. **19** adds three `security_invoker` views (customers with lifetime value,
inventory with a status bucket, coupons with redemption counts) and two RPCs — `admin_adjust_loyalty`,
because `loyalty_transactions` has no insert policy and the balance is trigger-derived, and
`admin_anonymize_customer`, which is GDPR erasure in one transaction.

**20** fixes a defect that had been live since M1: `apply_stock_movement` promised a named
`INSUFFICIENT_STOCK` error and could never raise it, because the column CHECK fired first
(docs/13 §P1). Warehouse managers had been getting "Something went wrong" for the one mistake the
screen most needed to explain.

### What M10 changed about access

`getProfile` now returns null for a soft-deleted profile. That single line is what makes both
"deactivate a colleague" and "erase a customer" take effect immediately rather than at the next
session expiry — every guard in the app already asks that function (docs/13 §P5).

The service-role caller list in docs/02 §6 gains two entries, both unavoidable and both narrow:
scrubbing a GoTrue identity during erasure, and creating or banning a staff account from
Settings → Team. Neither grants anything else: the _role_ is still written through the SSR client,
so `p_admin_update on profiles` and `prevent_role_escalation` both still apply.

---

## 14 · Launch checklist (docs/10 §9), item by item

M11's acceptance is "every checklist item ticked with evidence". Here is each one with its
evidence, or with the reason it cannot be ticked from a laptop.

### Ready — evidence in the repo

| Item                                       | Evidence                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Prod env vars validated                    | `env.server.ts` + `env.client.ts` fail the build on a missing required key; `tests/unit/env.test.ts`                     |
| Migrations applied                         | 22 on `rszbpdgfvyofvmuishmn`; `pnpm check:sql` gates structure in CI                                                     |
| Staff accounts with role rows              | Seven `@biocode.dev` accounts, roles verified. The password is not stored — `pnpm seed:users --reset-password` mints one |
| Compliance disclaimer on required surfaces | Asserted on five surfaces in both locales by `e2e/compliance.spec.ts`. It had covered two                                |
| Cookie consent live                        | Shipped M8, gates `lib/analytics.ts`                                                                                     |
| Sitemap + hreflang                         | Reciprocal sq/en alternates on every URL, asserted by `e2e/compliance.spec.ts` — which found `/finder` missing entirely  |
| E2E suite green                            | **416** across desktop and 390 px, against the live database (was 390 before the BioHack milestone)                      |
| RLS matrix green                           | `tests/integration/rls.test.ts`, plus the attack suite in `security.test.ts` (docs/09 §5)                                |
| Dependency audit                           | `pnpm audit` clean at `--audit-level moderate` — 3 high + 1 moderate cleared (docs/13 §Q5)                               |
| Security headers + CSP                     | Asserted by `e2e/security.spec.ts`; enforcement is `CSP_ENFORCE=true` (docs/13 §Q3)                                      |
| Admin surface refuses signed-out callers   | All 23 admin routes plus the export handler, asserted individually                                                       |
| Performance budget                         | `pnpm check:bundle` — every route inside 170 kB; storefront served from the route cache (§Q1)                            |
| Rollback plan                              | `vercel rollback` + `runbooks/incident.md`; migration recovery in `runbooks/restore.md`                                  |
| Restore procedure documented               | `runbooks/restore.md` — written, **not yet drilled**                                                                     |

### Blocked on the owner — not engineering work

| Item                                 | Blocked on                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Domain + DNS + www redirect + HTTPS  | No domain registered                                                                            |
| Resend verified, test sends land     | No account. **Fourteen templates are inert** and a newsletter subscription cannot complete (§6) |
| Sentry alerts firing test            | No DSN. The SDK is wired and inert without one                                                  |
| Uptime monitor active                | `/api/health` answers; nothing is pointed at it                                                 |
| Backup + restore drill done once     | Needs a scratch project. **Every step in the runbook is a guess until someone follows it**      |
| Real test order with courier handoff | Needs a courier and a real delivery address                                                     |
| Lighthouse ≥ 95 on prod              | Needs prod. Measuring on a laptop against a database in eu-west-1 proves very little            |
| Search Console submission            | Needs the domain                                                                                |

### Blocked on content

| Item                  | State                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legal pages final     | **Drafted, not reviewed.** Terms, privacy and shipping/returns are written (`supabase/seeds/06-static-pages.sql`) and live. They are accurate about what the software does, and they are not a lawyer’s work — checkout still makes customers accept them. The trader identification block carries a `[BIZNESI: plotëso]` marker, because only the owner has those facts |
| Real catalogue loaded | 24 demo fixtures. `pnpm purge:demo` cannot run until real products exist (§7 step 2)                                                                                |
| Health-goal intros    | ✅ All 16 written in both locales, 161–198 words each, claim-linted against `src/lib/claims.ts` (`supabase/seeds/05-goal-content.sql`)                              |
| Brand assets          | Real brand names with placeholder logos — replace with authorised assets (docs/11 §5)                                                                               |

### The one that is neither

**Supabase staging + production projects.** §7 records the decision to run one project for all
three roles. Every consequence of it is still live: the destructive suites are one `.env.local`
edit away from customer data, PITR matters more because there is no second database to fall back
on, and the auth quota is shared between the test suites and real customers (docs/13 §N10, §P3).

Nothing in M11 changed that, and nothing in the code can.

## 15 · What M11 deliberately left out

| Item                             | Why it is not here                                                                                                                                                                                              | When                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| A nonce-based CSP                | It forces every page dynamic and undoes the static rendering this milestone restored (docs/13 §Q3). The strict policy ships as report-only, so the day Next makes nonces cheap the reports are already clean    | When Next does        |
| Partial Prerendering for the PLP | `/shop` and the other filtered pages read `searchParams` and are dynamic by definition. Next's PPR addresses exactly this and is experimental in 15 — not a launch-week dependency                              | Next 16+, with §E2    |
| Visual regression screenshots    | docs/09 §1 asks for "lightweight, manual review, not pixel-diff". Artifacts nobody looks at are worse than none — the axe pass and the contrast unit tests caught what actually broke, twice (docs/13 §N7, §Q4) | If a visual bug ships |
| Zero-result search logging       | docs/10 §6 marks it Phase 2, and it needs traffic to say anything                                                                                                                                               | Post-launch           |
| Storage bucket backups           | docs/10 §7 accepts Phase 2. Worth knowing: **a database restore does not restore images**, and `restore.md` says so at the point it matters                                                                     | Post-launch           |
| Load / soak testing              | docs/12 asks for a staging soak. There is no staging (§7), and soaking the production database is not a test                                                                                                    | With a second project |

---

## 16 · The BIOCODE rebrand

The shop was built as SHNETA and rebranded to **BIOCODE** after M11. Recorded here because a
ledger that quietly changes its subject's name is not a ledger.

**Brand line:** _Your biology has a code. Unlock your potential._
**Campaign line:** _Unlock your biology._

### What changed

| Layer    | Before                          | After                                                                |
| -------- | ------------------------------- | -------------------------------------------------------------------- |
| Name     | SHNETA                          | BIOCODE                                                              |
| Wordmark | SHNETA, Space Grotesk           | BIOCODE, Space Grotesk Medium — from the brand kit                   |
| Mark     | Ring approximated with circles  | The kit's Vitality Ring, arc paths copied verbatim (docs/13 §R5)     |
| Palette  | forest / lime / cream           | **unchanged** — the kit keeps it                                     |
| Type     | Space Grotesk / Inter / Manrope | **unchanged**                                                        |
| Copy     | "Your health, simplified."      | "Your biology has a code. Unlock your potential."                    |
| Assets   | none in-repo                    | `public/brand/` — five SVGs + `USAGE.md`; favicon and app icon wired |

**The visual system did not change.** An earlier pass invented a blue-graphite palette and a
bar-sequence mark before the brand kit arrived; it was reverted in full once the kit showed the
identity was being kept. docs/13 §R1 records why, and it is the more useful half of this entry.

### What it is safe to forget, and is not

- **Cookies were renamed** (`shneta_cart` → `biocode_cart`). Every existing cart is orphaned by
  that. Free today because there are no customers; after launch the same change would need a
  read-both-write-new migration.
- **Six live staff accounts were migrated** from `@shneta.dev` to `@biocode.dev`, and
  `seed:users` now reconciles the address on re-run — it previously could not, and would have
  reported the new name forever while the accounts kept the old one (docs/13 §R3).
- **The `settings.store` row is data, not code.** It was updated in the live database; a fresh
  `supabase db reset` picks up the same values from `seed.sql`.
- **Fixture domains moved** to `%@biocode.test`, and `purgeFixtures` matches on that convention.
  Renaming one without the other would have left every future test row un-purgeable.

### Still outstanding after the rebrand

Nothing in §14 changed status. Two items gained a line of scope:

- **Brand assets** — the BIOCODE kit is in `public/brand/` and wired: header lockup, favicon,
  app icon. What is still missing is unrelated to the rebrand — the third-party _product_ brand
  imagery for the goods being resold, and `pnpm seed:images` (§8).
- **Domain** — `biocode.com` and the social handles in `settings.store` are placeholders written
  to look right. Nobody has registered them.

---

## 17 · The BioHack Protocol Generator

Built after M11, to the spec in **docs/15**. It is the first feature in the shop that produces a
recommendation rather than a listing, which changes what "shipped" has to mean for it.

### What is live

| Piece                    | State                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Schema                   | Migrations 21 and 22 applied. 4 tables, 2 enums, 3 columns, 1 security-definer RPC, RLS on all four                                    |
| Engine                   | `features/biohack/engine.ts` — pure, deterministic, 44 unit tests, three of them mutation-verified (docs/13 §T3)                       |
| Ruleset v1               | 51 blocks across all 16 goals, ≥3 per goal each with a core, 2 conflict rules, metric templates for all 16                             |
| Customer flow            | `/biohack` steps 1–2, `/biohack/[code]` result, `/biohack/kujdes` gate, `/p/[code]` share. 17 E2E specs, axe clean on all three screens |
| Admin                    | `/admin/biohack` — simulator, matrix, conflicts, settings, versions, analytics. axe clean on all six tabs                              |
| Approval                 | draft → pending_review → approved, one approved version enforced by a partial unique index, storefront cache purged on approval        |
| `/finder`                | 308 → `/biohack`; route, feature and its 21 unit tests deleted (docs/05 §10)                                                           |

### What it deliberately does not do

| Item                                | Why                                                                                                                                                                                                       | When                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Caffeine × sleep rule               | docs/15 §5 asks for a caffeine + L-theanine pairing and the conflict that goes with it. **The catalogue stocks neither ingredient.** The flags, the question and the engine's handling all exist and are unit tested; they filter nothing until such a product is stocked. An ingredient row with no product behind it would make the generator recommend something unbuyable | When the catalogue is real |
| Add-all conversion, most-swapped    | Neither is recorded. Swaps are client state by design (docs/13 §T6) and a cart carries no reference to the protocol that filled it. Both need an event to exist first — the analytics card says so on its face rather than showing a zero | Needs an events table    |
| Drag-to-reorder in the matrix       | Weight is not a rank — it *sums across goals*, which is the whole synergy mechanism. A drag handle expresses the order of one list and says nothing about the number that produced it                     | Not planned              |
| A diff view for compliance          | docs/15 §4 asks compliance to review "a diff of all copy + rules". They currently review the draft itself in the matrix and conflicts tabs. A real diff needs a per-field comparison against the approved version | Before a second version ships |

### What it adds to the launch checklist

Nothing blocking, and one thing worth knowing: **the generator is dark without an approved
config.** `getApprovedConfig` returning null means `/biohack` shows an error rather than an empty
protocol — deliberate, so the failure is legible — but it means migration 22 is not optional
infrastructure. It ships as a migration rather than a seed for exactly that reason: the linked
project receives migrations only.

---

## 18 · The launch-copy pass

Everything in §14's "blocked on content" row that engineering could actually write, written.

### Done

| Item                 | State                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Health-goal intros   | All 16, both locales, 161–198 words each. Every one is checked against the banned-verb list in `src/lib/claims.ts` — the same list the BioHack editor hard-blocks on     |
| `/about`             | Written, both locales                                                                                                                                                   |
| Terms of use         | Written. Prices, VAT, the 20-unit cap, cash-on-delivery and the card method being off are all read off the implementation rather than assumed                           |
| Privacy policy       | Written. The "what we collect" section is an inventory of what the code actually stores, processor by processor, including the BioHack answers                          |
| Shipping and returns | Written. €2.00 standard / free over €30.00 / 1–3 days, €4.00 same-day Prishtina, the 14-day withdrawal right and the sealed-goods exception that applies to supplements |
| Store contact        | `info@biocode.com` and `+383 40 000 000` are gone. The email is on the domain that exists; the phone and the three social URLs are **empty rather than invented**       |

### Still outstanding, and only the owner can close it

1. **Legal review.** The three pages above were written by engineering. They are accurate about
   the software and they are not a substitute for someone qualified in Kosovo consumer and data
   protection law. Checkout makes every customer tick a box accepting them.
2. **Trader identification.** Terms and privacy both carry `[BIZNESI: plotëso]` where the
   registered name, business number, fiscal number and registered address belong. A distance
   seller is legally required to identify itself; inventing those would be worse than the gap.
3. **A real phone number** in `/admin/settings`, and the socials if they exist. A shop selling
   cash-on-delivery with no phone number is a real friction point.
4. **`info@shtrejt.com` must actually receive mail.** Resend is configured to *send* from the
   domain; receiving needs MX records. Every legal page tells customers to write to that address.

### One workflow trap found while applying it

**`supabase db push --include-seed` does not re-run a seed file whose contents changed.** It
prints `Updating seed hash to …`, records the new hash, and skips execution; only a file it has
never seen runs. So an edit to `seed.sql` reaches a fresh `db reset` and silently never reaches
the linked project.

Found by editing the store block in `seed.sql`, pushing, and watching the live row keep saying
`info@biocode.com`. The correction had to become its own numbered file
(`seeds/07-store-contact.sql`) to land. In practice, seed corrections behave like migrations and
have to be numbered like them.

## 19 · The merchant marketplace (M12)

Built and green. What follows is the honest state of it, in the same terms as every other section
here: what works, what is deliberately not built, and what only the owner can finish.

### What works, end to end

A merchant applies at `/merchant/apply`, uploads its registration certificate, and is approved with a
commission and a shipping arrangement chosen at that moment. It adds offers against BioCode's
canonical products; a product manager approves them; the cheapest approved in-stock offer wins the buy
box wherever BioCode has no stock of its own. A customer buys it at the canonical price, the offer's
stock is reserved at checkout, an admin routes the fulfilment, the merchant accepts, packs and ships
it, BioCode records delivery, and the ledger owes the merchant its net. A fortnightly run cuts a
statement, somebody makes the transfer and records the reference.

A merchant can also propose a product BioCode does not list, **with photographs of the box**; approving it
creates a draft product carrying them, which the catalogue team prices, writes and sends to compliance.

Both of those work in bulk, which is what makes onboarding a real merchant possible rather than theoretical
(docs/16 §6.1, §9.1). A pasted sheet **creates** draft offers for SKUs the merchant has none on — with a
catalogue export so it knows our codes — and a pasted catalogue of products we do not list arrives as a
**batch**: one queue item, up to 200 rows, photographs matched to rows by filename, rejected per row and
approved as a unit. Approved rows become draft products, ten immediately and 25 a night thereafter.

Every step of that is covered by tests: **308 unit, 354 integration, 484 E2E**, all passing.

### What is deliberately not built

- **Auto-routing is off.** The code exists and is tested; `settings.marketplace.auto_route` is
  `false`. The scorecard it picks candidates by needs weeks of real fulfilments before its numbers
  mean anything, and manual routing is where an operator learns which merchants actually answer.
- **`customer` shipping adds no surcharge at checkout.** The customer is charged one delivery fee
  before routing happens, so there is no per-merchant line to add at the moment money is taken. It
  means "covered by the fee already collected" and is a distinct value for attribution, not arithmetic
  (§8).
- **No public seller page.** `/seller/[slug]` is reserved and not built. The seller is named on the
  product page, which is the disclosure that matters; a merchant storefront is a v2 feature.
- **No merchant switcher.** A person may belong to more than one merchant and the portal shows the
  first. Ordered by `created_at`, so "the first" is at least stable.
- **Approving a proposal creates a _draft_ product, not a listing.** It carries the merchant's
  photographs, name, brand and form, and the price is written as the merchant's asking price and flagged
  provisional. A draft is invisible on the storefront and publishing needs `compliance.approve`, so the
  copy, the ingredients, the warnings and the compliance pass all still happen on the catalogue screens.
  Nobody's photograph reaches a customer without a compliance officer having looked.
- **Nothing cleans up abandoned proposal images.** A merchant who uploads three photographs and closes
  the tab leaves three objects in a private bucket with no row pointing at them. They are invisible and
  cost almost nothing; a cleanup job keyed on rows that were never written is more machinery than the
  problem deserves. Removing one before submitting works, which covers the case a merchant notices. The
  bulk uploader has the same property at a larger scale — three hundred files chosen and never attached — and
  the same answer.
- **A batch cannot be edited or withdrawn.** A merchant that pasted a sheet with the wrong prices has to
  wait for a reviewer to reject it, and its three open-batch slots are held meanwhile. Deliberate for now:
  the alternative is letting a merchant mutate rows a reviewer may already be reading, which is the exact
  problem `p_own_update` exists to prevent (docs/13 §X15). If it bites in practice, the shape is a
  merchant-initiated `withdraw` that only touches batches nobody has decided.
- **Bulk offer creation never sends offers for review by itself.** A pasted row becomes a `draft`, and the
  merchant still has to submit each one — deliberately, because submitting is a decision about a price, and
  200 of them are not one decision. If merchants ask for a "submit all drafts" button, that is a small,
  separate thing to add.
- **KYB documents are never verified automatically.** A human opens each one. `verified` is a column
  somebody ticks.

### What only the owner can do

1. **Legal review of the marketplace terms, now at version `1.1`.** Written by engineering, accurate about
   what the software does, and not a substitute for review by somebody qualified in Kosovo commercial and
   data-protection law. The trader identification block still carries `[BIZNESI: plotëso]`.

   **Clause 14 most of all.** It is the newest and the one with the most legal weight per word: the seller
   grants BioCode a licence to use the photographs it uploads, and *warrants* that it holds the rights in
   them and that they depict the real product. Approving a proposal publishes those images under BioCode's
   name on a BioCode product page — so if that warranty does not hold up, the exposure is BioCode's.

   **And version `1.1` has no re-acceptance flow.** Merchants who accepted `1.0` still read `1.0` in
   `merchants.terms_version`; nothing prompts them, and nothing blocks them from uploading images under an
   agreement that did not mention images. Two ways to close it, and it is a business decision which:
   serve the 30-day notice clause 1.1 provides for, or gate the portal on re-acceptance. Until one
   happens, **clause 14 binds only merchants onboarded after the bump.**
2. **Decide the default commission** in `settings.marketplace.default_commission_pct`. It is 15 and
   nobody has agreed to that number — it is a placeholder that the approve form prefills.
3. **Decide `shipping_cost_cents`**, currently €2.00, which is what a merchant bearing shipping is
   deducted per fulfilment. Also a placeholder.
4. **Recruit the first merchants.** Nothing here has been used by a real business.

### One operational thing to know before the first payout

**A merchant is owed on delivery, and delivery is BioCode's word to record.** If nobody marks orders
delivered, no merchant is ever paid and the balance stays at zero while parcels arrive at customers'
doors. The order screen's delivered transition is what drives the entire money side, and it is the one
manual step the whole marketplace depends on.

The payout cron builds statements on the 1st and the 16th; it does not pay anybody. Transfers are
manual and recorded with a bank reference on `/admin/payouts`.

---


## 19b · The referral programme (M13)

Built after the marketplace, in the order docs/17 §8 lays out. What it does: a customer has a permanent
`BIO-XXXXX` code; somebody who registers with it is linked to them for ever, and for twelve months the
referrer earns **1% of that customer's eligible spend, paid in loyalty points**.

| Item | State | Evidence |
| --- | --- | --- |
| Codes on every profile, generated at signup | ✅ | `generate_referral_code()`, alphabet with no O/0/I/1/S/5 |
| Entry by three routes | ✅ | sign-up field, `/r/{CODE}` + 30-day httpOnly cookie, account until the first order |
| One referrer per customer, for ever | ✅ | `unique (referee_id)`; self, cycle and shared-phone all refused |
| Accrual on delivery, with clawback | ✅ | 21 integration tests; €100 → exactly 100 points; partial refunds converge |
| `/account/referrals` | ✅ | share tools, WhatsApp/Viber, server-rendered QR, masked list, axe clean |
| `/admin/referrals` | ✅ | queue with signup gaps, links, manual link, earnings + CSV, fraud panel; 21 tests |
| `/api/cron/referrals` | ✅ | expire · auto-approve · monthly true-up · expiry notices · event emails; 33 tests |
| Seven bilingual emails | ✅ | logged through `email_log`; copy privacy asserted by a unit test |
| `/legal/referral-terms` | 🟡 | written and live, **not reviewed by a lawyer** — see §7 item 6 |
| Referrer cannot learn what a referral spent | ✅ | no referrer policy on `referral_links`, no customer policy at all on `referral_earnings`, asserted in both directions |

**The privacy design is the substance of this milestone**, and it is worth stating what it cost. docs/17
§0.2 admits a limit that cannot be engineered away: a referrer with exactly one active referral can
divide their own points by the rate and read that person's spend. Everything else exists to stop the
*shape* of the data making it worse — and "everything else" is a set of **absences**, which is precisely
what nobody notices breaking. So they are asserted directly: the RPC's payload keys, the missing
policies, the null `order_id` on a referral ledger row, and an allowlist of the placeholders the email
templates may use.

**Two decisions are the owner's, not the code's:**

1. **1% back.** §0.1 unified the point value, which took loyalty from an effective 5% to 1%. It is
   coherent and it is a price change. See §7 item 7.
2. **`auto_approve` ships off.** Every referral waits for a person. Turning it on approves a link once
   the referred customer's first order is delivered — and never approves a link carrying a risk flag,
   which is what keeps the fraud panel from becoming decorative.

---


## 20 · What is actually left, as of the audit on 2026-08-04

Written after going looking rather than after reading this document — several rows above had gone stale,
and a launch ledger nobody re-checks is worse than none. Everything here was verified against the live
site and the live database on the day.

### Fixed during the audit

- **Every URL in the production sitemap had a doubled slash.** `NEXT_PUBLIC_SITE_URL` was set to
  `https://www.shtrejt.com/`, `z.url()` accepted the trailing slash, and all fifteen consumers build
  `${origin}/path` — so `<loc>https://www.shtrejt.com//</loc>` was the advertised canonical home page,
  `//shop` every product URL, `//en` every English alternate, and `//api/auth/callback` the address
  Supabase was asked to redirect to. To Google those are different URLs, none of them the real one. The
  parser now strips trailing slashes, and `e2e/compliance.spec.ts` asserts it on the rendered sitemap and
  on `robots.txt` — the assertion that was missing, since the reciprocity test passed throughout by being
  consistently wrong. **This needs a deploy to take effect: the value is read at build time.**
- **Forty draft products had leaked onto the shared project in one day**, from §9 making approval create
  products while three separate cleanup paths knew nothing about it. Fixed in the teardown, the E2E spec
  and the purge; recorded as docs/13 §X16. Storage had the same shape of leak — 56 orphaned objects across
  two buckets, now swept by existence rather than by pattern.
- **Promotion wrote images to a different path than the product editor**, under a comment claiming it did
  not. One convention now.
- **Approving a batch could have timed out in production.** It promoted ten proposals inline at about a
  second each; Vercel's default function duration is ten seconds. Now five, with `maxDuration = 60`
  declared on the page that hosts the action, and the nightly sweep lowered from 25 to 15 for the same
  reason against the cron's shared 60 s.
- **A decided batch had no link anywhere in the admin panel.** The reviewer who decided it could not find
  it again; the merchant could. Answered catalogues are now listed.

### Left, and only the owner can do them

1. **`RESEND_API_KEY` and `EMAIL_FROM` in Vercel.** Both are set locally, so `pnpm email:test` works from a
   laptop; whether the deployment has them is not visible from here. Until it does, every template records
   `skipped_no_provider` in `email_log` and a newsletter subscription cannot complete. **Check `email_log`
   after a real order rather than trusting a settings screen.**
2. **`CSP_ENFORCE=true`.** Production serves `content-security-policy-report-only` today — the policy is
   correct and nothing enforces it. Flip it after watching the report endpoint for a few days.
3. **`SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`.** Both unset, so the SDK is inert and nothing reports.
4. **Separate the test project from production (§7).** This moved from "risky" to "actively visible" during
   the audit: a report of *test-related names in the category list* turned out to be E2E fixtures — `Emri
   Provë`, `Kategori e Zënë`, `Prindi` — rendering in the shop's category sidebar **while the suite ran**,
   for the twenty-five minutes it takes. The purge removes them afterwards, the tests are correct to create
   them, and nothing is broken. It is the shared project that is wrong (docs/13 §X17).

   Until there are two projects: delete `SUPABASE_TEST_PROJECT` from `.env.local` before real customers
   arrive and never set it in Vercel, and do not run the suites while anyone is shopping.
5. **PITR / backups, an uptime monitor on `/api/health`, and a restore drill.** All three unchanged.
6. **Legal review of all three terms documents**, clause 14 most of all, and the `[BIZNESI: plotëso]` trader
   block. Terms are at `1.1` with no re-acceptance flow (§19).

   The third is **`/legal/referral-terms`**, added with M13 step 3 (`supabase/seeds/15-referral-terms.sql`).
   Same status as the others: written by engineering, accurate about what the software does, not reviewed.
   Two things about it need a second pair of eyes specifically. Clause 6 is a **promise about what one
   customer can learn about another**, and it is the customer-facing statement of docs/17 §0.2 — it should
   be read against what the RPC actually returns before anybody relies on it. And clauses 4 and 5 write out
   `1%`, `100 points = €1`, `€10` and `20,000 points` as numbers, because a customer cannot read a settings
   table; if `settings.referral` or `settings.loyalty` is ever changed, **this page is wrong until it is
   edited**. Its clause 9 carries the same `[BIZNESI: plotëso]` contact marker as the others.
7. **The commercial numbers nobody has agreed to**: 15 % default commission, €2.00 shipping deduction, and
   now the loyalty redemption rate.

   docs/17 §0.1 replaced `redeem_points` + `redeem_value_cents` — a conversion rate encoded in two numbers
   that could disagree — with a single `point_value_cents`, set to **1**. That is arithmetic, but it has a
   commercial consequence nobody has signed off: the old pair said 100 points redeemed for €5, so a customer
   earning 1 point per euro was getting **5 % back**; at one point = €0.01 they get **1 %**. 1 % is the rate
   the referral programme is built around and the rate the seeded settings and both terms pages now state.
   If 5 % was intended, `settings.loyalty.point_value_cents` is the one number to change — and
   `/legal/referral-terms` and the loyalty terms in `messages/{sq,en}.json` have to change with it.
8. **Photography.** The catalogue itself is now finished — 63 published products across 16 categories, 14
   brands, bilingual claim-safe copy, EUR prices benchmarked to European retail, SEO on every page (seeds
   12–13, docs/11 §11). What it has no images at all. `pnpm seed:images ./photos` uploads a folder named
   after product slugs and is proven idempotent, so this is a drag-and-drop job once assets exist — from
   the manufacturers' dealer portals or from a camera. It is **not** a job that can be done by copying
   another retailer's photographs: those are theirs, and the pages that would carry them are the pages that
   earn the money. Migration 14 makes an image a precondition of publishing, so this gates everything the
   catalogue team creates from now on.
9. **Reprice against real invoices.** The seeded prices are benchmarked to typical European online retail,
   which is a starting point and not a margin: nobody has costed a delivery to Prishtinë or agreed a landed
   cost with a distributor.
10. **Confirm which brands you can actually supply.** Fourteen are listed, all real manufacturers with
    European distribution, but listing a brand is not the same as having an agreement with it. Deactivate
    the ones you cannot get — `is_active = false` on the brand **and** unpublish its products, because they
    are filtered separately.

### Known and deliberate, not defects

`/seller/[slug]`, a merchant switcher, batch withdrawal, "submit all drafts", and cleanup of abandoned
uploads — each is listed with its reasoning in §19.

## 21 · The domain moves to `biocode.fit`

The brand is BIOCODE. `biocode.com` was unavailable, so `shtrejt.com` was registered to hold the DNS and
the Resend records, and the shop has been served from it since launch prep. The brand now has
**biocode.fit**, so the two finally agree.

Sections above still name the old domain where they are describing what happened at the time — the
doubled-slash incident in §20 was on `shtrejt.com`, and rewriting that would make the record wrong.

### Moved in code and content — nothing left to do

- **Everything that links somewhere already derived from `NEXT_PUBLIC_SITE_URL`**: canonicals, hreflang,
  `robots.txt`, `sitemap.xml`, auth callbacks, the links in fourteen email templates. Verified on a build
  with the new value: **495 sitemap URLs on `biocode.fit`, zero doubled slashes, zero old-domain
  references.**
- **The two display-only hostnames that were literals now read it too**, via `lib/site.ts`: the
  invoice/packing-slip header and the SEO preview in the product editor. These were the ones docs/14 §6
  warned "must move together" — and a literal in a component is exactly what a migration misses, so the
  literal is gone rather than updated.
- **One customer-facing string had it hardcoded in both locales** — the merchant-application duplicate
  error told an applicant to write to `info@shtrejt.com`. Fixed in `sq` and `en`.
- **Content moved in the database**: `settings.store.email`, the BIOCODE brand's website, and 14
  occurrences of the contact address across terms, privacy and shipping-returns, in both locales. Applied
  by `supabase/seeds/14-domain-biocode-fit.sql`; the source seeds were edited too so a fresh `db reset`
  produces the new domain.

  That seed had to exist as a *new file* because a changed seed is not re-run — the push output said
  `Updating seed hash to supabase/seeds/06-static-pages.sql...` and skipped the statements, which is
  docs/13 §U1 demonstrating itself.

### What only the owner can do — `runbooks/deploy.md` §5 has the ordered version

Three of these break the live site if done in the wrong order, which is why the runbook exists rather
than a list here:

1. Own `biocode.fit`, add it to Vercel with `www` redirecting to the apex, point DNS at Vercel.
2. **Supabase → Auth → URL Configuration** *before* step 4: add the new site URL to the redirect
   allowlist, or every password-reset link in flight dies the moment the variable flips.
3. **Resend → verify `biocode.fit`**, then move `EMAIL_FROM` to `porosite@biocode.fit`. Not before:
   sending from an unverified domain is accepted and then filed as spam, so `email_log` says `sent` and
   the customer has nothing.
4. Flip `NEXT_PUBLIC_SITE_URL` to `https://biocode.fit` — no trailing slash — and **redeploy**, because
   it is read at build time.
5. Redirect `shtrejt.com` → `biocode.fit` at the Vercel domain level, permanent, and **keep it for at
   least a year**. Removing the old domain instead of redirecting it throws away every accumulated
   ranking signal and breaks every link in the wild.
6. Search Console: add the new property, submit the sitemap, then **Change of address** on the old one.
7. MX for `info@biocode.fit` — the legal pages now tell customers to write there, so it has to receive.

### One thing to decide

Apex or `www`. The runbook assumes **apex** (`https://biocode.fit`) with `www` redirecting to it, because
the name is short and it reads better in print. Whichever is chosen has to match `NEXT_PUBLIC_SITE_URL`
exactly — a canonical that names one and a server that serves the other is duplicate content, and it is
the kind of mistake that costs three months of indexing.
