# 02 · Architecture

## 1. Final stack

| Layer            | Choice                                                                                           | Notes                            |
| ---------------- | ------------------------------------------------------------------------------------------------ | -------------------------------- |
| Framework        | Next.js 15, App Router, React 19, TypeScript strict                                              | RSC-first                        |
| Styling          | Tailwind CSS v4 (`@theme` tokens) + shadcn/ui + lucide-react                                     | tokens in docs/04                |
| Data/Auth/Files  | Supabase: Postgres, Auth (email+password, email verification), Storage                           | schema docs/03                   |
| DB access        | `@supabase/ssr` clients + generated types (`supabase gen types`)                                 | **no ORM** (decision log #2)     |
| Client data      | TanStack Query v5 — admin tables, cart drawer, interactive widgets only                          | RSC fetch elsewhere              |
| Forms/validation | React Hook Form + Zod (shared schemas client/server)                                             |                                  |
| Motion           | Framer Motion (variants in docs/04 §10)                                                          | reduced-motion aware             |
| i18n             | next-intl, locales `sq` (default, unprefixed) + `en`                                             | messages in `src/i18n/messages/` |
| Email            | Resend + react-email templates                                                                   | docs/08 §6                       |
| Payments         | internal `PaymentProvider` abstraction: `cod` (v1), `bank_pos` (adapter stub), `stripe` (future) | docs/07 §6                       |
| Search           | Postgres FTS + pg_trgm (v1) → Meilisearch (phase 2)                                              | docs/03 §7                       |
| Tests            | Vitest + Testing Library; Playwright E2E (+ axe)                                                 | docs/09                          |
| Hosting          | Vercel (app, cron, analytics) + Supabase cloud; Sentry                                           | docs/10                          |

Allowed additional deps: `date-fns`, `clsx`/`tailwind-merge` (via shadcn `cn`), `react-markdown` + `remark-gfm` + `rehype-sanitize` (article bodies), `recharts` (admin charts), `@upstash/ratelimit` + `@upstash/redis` **or** the built-in Postgres rate limiter (§9 — choose Postgres unless Upstash keys are provided), `server-only`, `zod`, `@paulmillr/qr` (referral QR codes — see below). Anything else requires justification (CLAUDE.md).

**`@paulmillr/qr`**, added in M13 step 5 for the referral QR (docs/17 §4). The justification, since
CLAUDE.md requires one: a QR encoder needs Reed–Solomon error correction, and a hand-rolled one that
*most* scanners read is worse than none. The two alternatives were both worse — a QR image service is
blocked by the CSP and would hand a customer's invite code to a third party, and inlining a
hand-written encoder puts a subtle correctness risk in a page nobody will re-test. Zero runtime
dependencies, MIT/Apache-2.0, native TypeScript.

It costs the browser **nothing**: `referralQrDataUri()` is server-only and returns a 2 kB `data:` URI,
so the library never enters a client bundle and `data:` is already in the `img-src` allowlist.

## 2. System overview

```
Browser ──► Vercel (Next.js)
             ├── RSC pages (static/ISR) ──► Supabase Postgres (anon key, RLS)
             ├── Server Actions (Zod) ────► Supabase (user JWT via @supabase/ssr, RLS)
             │                              └─ checkout_create_order() RPC (atomic)
             ├── /api/webhooks/payments ──► service-role client (verify → update order)
             ├── /api/cron/* (Vercel Cron)► service-role client (subscriptions, review emails)
             └── Resend (email)            Supabase Storage (images public / lab-reports private)
```

## 3. Repository layout

```
biocode/
  CLAUDE.md  docs/  supabase/{config.toml, migrations/, seed.sql}
  public/    src/   .github/workflows/ci.yml
  package.json  next.config.ts  tsconfig.json  playwright.config.ts  vitest.config.ts
```

## 4. `src/` structure

```
src/
  app/
    [locale]/                    # storefront, localePrefix 'as-needed' (sq unprefixed)
      (storefront)/
        page.tsx                 # Home
        shop/ [category]/        # PLP
        product/[slug]/          # PDP
        brands/ brands/[slug]/
        goals/ goals/[slug]/
        ingredients/ ingredients/[slug]/
        knowledge/ knowledge/[slug]/
        search/ compare/ finder/ offers/
        cart/ checkout/ checkout/success/[orderNumber]/ order-lookup/
        about/ contact/ faq/ legal/[slug]/
      (auth)/auth/{sign-in,sign-up,forgot-password,reset-password,verify}/
      account/{page,orders,orders/[id],subscriptions,addresses,wishlist,reviews,loyalty,settings}/
      layout.tsx not-found.tsx error.tsx
    admin/                       # NOT localized; guarded layout (§8)
      layout.tsx page.tsx        # dashboard
      orders/ orders/[id]/
      products/ products/new/ products/[id]/
      categories/ brands/ ingredients/ goals/
      inventory/ inventory/movements/
      customers/ customers/[id]/
      reviews/ coupons/ subscriptions/
      content/{articles,articles/[id],pages,faqs,banners}/
      compliance/
      settings/{store,shipping,payments,tax,team,audit}/
    api/
      webhooks/payments/[provider]/route.ts
      cron/{subscriptions,review-requests}/route.ts
      revalidate/route.ts        # optional on-demand ISR (secret-guarded)
    sitemap.ts robots.ts manifest.ts
  components/
    ui/                          # shadcn primitives (generated)
    storefront/                  # ProductCard, PriceTag, RatingStars, Navbar, MegaMenu,
                                 # Footer, CartDrawer, VariantSelector, QuantityStepper,
                                 # SubscribeToggle, IngredientTable, FilterSidebar, ...
    admin/                       # DataTable, StatCard, StatusBadge, AdminShell, ...
    shared/                      # EmptyState, Skeletons, LocaleSwitcher, Price, ...
  features/                      # domain logic: one folder per domain
    auth/ cart/ checkout/ orders/ catalog/ reviews/ wishlist/ subscriptions/
    loyalty/ coupons/ inventory/ content/ finder/ customers/ settings/ compliance/
      # each: actions.ts  queries.ts  schemas.ts  types.ts  components/ (feature-private)
  lib/
    supabase/{server.ts, client.ts, admin.ts, middleware.ts, database.types.ts}
    payments/{types.ts, index.ts, cod.ts, bank-pos.ts}
    email/{send.ts, templates/*.tsx}
    money.ts i18n.ts seo.ts rate-limit.ts utils.ts constants.ts result.ts
  i18n/{routing.ts, request.ts, messages/{sq.json, en.json}}
  middleware.ts                  # next-intl + admin session gate
  styles/globals.css             # @theme tokens (docs/04)
tests/ e2e/
```

Rules: `features/*` never import from `app/`; `components/storefront|admin` may import feature components but not actions directly (pages wire actions in); `lib/` is dependency-leaf.

## 5. Rendering & caching strategy

| Routes                                                                           | Mode                             | Revalidation                                |
| -------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------- |
| Home, PLP, PDP, brands, goals, ingredients, knowledge, offers, static pages, FAQ | Static + ISR, `revalidate = 300` | + on-demand `revalidateTag` on admin writes |
| Search, compare, `/biohack`                                                      | Dynamic (query-driven)           | —                                           |
| `/biohack/[code]`, `/p/[code]`                                                   | Dynamic, no cache                | —                                           |
| Cart, checkout, account/**, order-lookup                                         | Dynamic, no cache                | —                                           |
| Admin/**                                                                         | Dynamic, `no-store`              | —                                           |

Cache tags (use exactly these): `products`, `product:{slug}`, `categories`, `brands`, `brand:{slug}`, `goals`, `ingredients`, `ingredient:{slug}`, `articles`, `article:{slug}`, `banners`, `settings`, `shipping`, `biohack-config` (purged on approval and on an engine-settings change; see `BIOHACK_TAGS`). Every admin mutation that touches public content calls `revalidateTag()` for the affected tags (helper `revalidatePublic(tags: string[])` in `lib/utils.ts`).

`generateStaticParams` prebuilds: top 200 products, all categories/brands/goals, published articles; everything else renders on demand then caches.

## 6. Supabase clients — exact usage rules

| Client               | File                                                       | Key     | Where used                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server (user ctx)    | `lib/supabase/server.ts` (`createServerClient` w/ cookies) | anon    | RSC reads, server actions — **default choice**                                                                                                                                                                                                                                                                                                      |
| Browser              | `lib/supabase/client.ts`                                   | anon    | client components needing realtime/auth state (rare)                                                                                                                                                                                                                                                                                                |
| Admin (service role) | `lib/supabase/admin.ts` (imports `server-only`)            | service | ONLY: payment webhooks; cron jobs; guest-cart ops keyed by `anon_token`; guest order lookup (number+email); email dispatch logging; auth-user provisioning in seed scripts; **GDPR erasure — scrubbing the GoTrue identity** (`customers/actions.ts`, M10); **team management — creating and banning a staff account** (`settings/actions.ts`, M10); **BioHack — loading the approved ruleset, writing a generated protocol, and reading one back by share code** (`biohack/config-loader.ts`, `biohack/actions.ts`, `biohack/queries.ts`); **marketplace — submitting an application before any membership exists** (`merchants/actions.ts`, M12), **merchant/marketplace email recipients and the partial-shipment sweep** (`merchants/email.ts`, `merchants/partial-shipment-email.ts`, M12), **releasing a declined fulfilment** (`merchants/fulfilment-actions.ts`, M12), **copying an approved proposal's photographs onto the draft product** (`merchants/proposal-promote.ts`) |

Middleware refreshes the session per `@supabase/ssr` docs. Any new service-role usage must be added to this table via PR.

The two M10 entries are both GoTrue operations with no user-context equivalent — an anon-key
client cannot create, ban or re-address an auth user. Both are deliberately narrow: the service
client mints or scrubs the _identity_ only, and the **role** is written through the SSR client, so
`p_admin_update on profiles` and `prevent_role_escalation` still apply. Neither path can grant a
permission (docs/13 §P4, §P5).

The three BioHack entries are each the same shape of problem: **a table with no policy for the
caller, on purpose.** The config tables are staff-read only, so an anonymous visitor generating a
protocol cannot read the weights, the draft copy compliance has not signed, or the conflict
matrix — the engine's inputs are fetched server-side and only the *result* reaches the browser.
`generated_protocols` has no insert policy for anyone, because a guest has no session to write
under and an anon insert policy would let anyone write arbitrary rows into the table behind the
analytics card; the row's shape is fixed by the action instead. And the read-back is by share
code, which a guest's own row would otherwise be invisible to under own-rows-only RLS.

The four marketplace entries were added late — M12 shipped them without this table being updated, which
is exactly the drift the "via PR" rule exists to prevent. Each is the same shape as the others: the caller
has no user context that RLS could grant anything to.

- **The application** (`merchants/actions.ts`) writes the `merchants` row that the applicant's future
  membership will point at. There is no membership yet, so `current_merchant_ids()` is empty and every
  policy on the table returns nothing — the row has to exist before the relationship that authorises
  creating it. The slug search runs on the same client for the same reason.
- **The emails** (`merchants/email.ts`, `merchants/partial-shipment-email.ts`) resolve a recipient across
  merchants, orders and profiles, and read `email_log` for idempotence. Identical to the existing
  email-dispatch entries; the partial-shipment case additionally *sweeps* orders, because the transition
  that triggers it is made by a database trigger with no single code path to hang a send on.
- **Declining a fulfilment** (`merchants/fulfilment-actions.ts`) calls `release_fulfilment`, which returns
  stock to the offer and puts the line back in the routing queue. The merchant may decline; it must not be
  able to write the queue it is declining out of.
- **Promoting a proposal** (`merchants/proposal-promote.ts`) downloads from a private bucket and uploads to
  a public one. A product manager holds both halves in their own session, so this is not about
  capability — it is that the same function must work from a caller with no session at all, and one path
  that works for every caller beats two that differ only in which client they hold.

None of the three BioHack entries is a shortcut around a missing policy: in each case the absence of the
policy _is_ the security property. Note the deliberate asymmetry with `/p/[code]`, the public share page,
which uses the **anon** client and the `get_shared_protocol` RPC — a security-definer function
that returns `result` and nothing else, so the page physically cannot read the `inputs` that
record someone's medication and life-stage answers. `/admin/biohack` likewise reads through the
**SSR** client, so the staff-read policies apply to the people they were written for.

## 7. Server Action contract

Every mutation: `features/<domain>/actions.ts`, `'use server'`, shape:

```ts
// lib/result.ts
export type ActionResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
```

Pattern (mandatory): parse input with the feature's Zod schema → auth/role check (when required) → rate-limit check (when listed in §9) → perform via server client (RLS) or RPC → `revalidateTag`/`revalidatePath` as needed → return `ActionResult`; catch and log unexpected errors to Sentry, return generic `error` (never leak internals). Forms use RHF + `useTransition`/`useActionState`; optimistic UI only for cart quantity and wishlist toggles.

Naming: `createX`, `updateX`, `deleteX`, `toggleX`, verbs first. Reads used by client components live in `queries.ts` and are called through route-level RSC props or lightweight actions.

## 8. Auth & route protection

- Supabase Auth email+password; email verification required before checkout-as-user (guests unaffected). Password reset via Supabase flow; auth emails use Supabase templates restyled to brand (docs/08 §6).
- `middleware.ts`: session refresh + redirect unauthenticated users from `/account/**` to `/auth/sign-in?next=…`, and from `/admin/**` to `/auth/sign-in`.
- `app/admin/layout.tsx` (server): loads profile role; if role ∉ staff set → `redirect('/')`. Sidebar renders only sections the role may access (matrix docs/01 §3); each admin server action re-checks the role. RLS remains the final guard.
- Profile row auto-created by DB trigger on signup (docs/03 §8). Role changes: admin-only, audited.

## 9. Rate limiting & abuse

Postgres-based limiter (default): table `rate_limits(key text, window_start timestamptz, count int)` + `check_rate_limit(p_key text, p_max int, p_window interval)` RPC (docs/03 §8). Wrap in `lib/rate-limit.ts` (`limit(key, max, windowSec)`), keyed by IP (from headers) + action. Apply to: sign-in/up (5/15 min), forgot-password (3/15 min), checkout (10/h), contact (3/h), review create (5/d), newsletter (3/h), finder submit (10/h). Bot honeypot field on contact + newsletter forms.

## 10. Error handling, logging, observability

- `error.tsx` per layout group (friendly, localized, "try again"); `not-found.tsx` with search + popular categories.
- Sentry: client + server + edge configs; tag `feature`, `action`; scrub PII (emails, addresses) via `beforeSend`.
- `lib/logger.ts` thin wrapper (`info/warn/error`) → console (structured JSON in prod). No `console.log` in committed code.
- Money-affecting failures (checkout RPC, webhooks, cron) additionally write an `order_events`/`audit_logs` row.

## 11. Environment variables (full table in docs/10 §3)

`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`, `REVALIDATE_SECRET`, `SENTRY_DSN`, `BANK_POS_*` (later), `UPSTASH_*` (optional). Client-exposed vars must be `NEXT_PUBLIC_`-prefixed and non-secret.

## 12. Coding standards (enforced by ESLint/Prettier + review)

Strict TS (`noUncheckedIndexedAccess: true`); explicit return types on exported functions; no default exports except Next.js route files; imports via `@/` alias; components ≤ ~250 lines (split otherwise); Zod schemas single-sourced in `schemas.ts` and reused client+server; dates handled in UTC in DB, formatted with `date-fns` + locale at the edge; timezone constant `Europe/Belgrade` (CET, valid for Kosovo) in `lib/constants.ts`; accessibility lint (`eslint-plugin-jsx-a11y`) on.
