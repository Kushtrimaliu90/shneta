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

Allowed additional deps: `date-fns`, `clsx`/`tailwind-merge` (via shadcn `cn`), `react-markdown` + `remark-gfm` + `rehype-sanitize` (article bodies), `recharts` (admin charts), `@upstash/ratelimit` + `@upstash/redis` **or** the built-in Postgres rate limiter (§9 — choose Postgres unless Upstash keys are provided), `server-only`, `zod`. Anything else requires justification (CLAUDE.md).

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
shneta/
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
| Search, compare, finder                                                          | Dynamic (query-driven)           | —                                           |
| Cart, checkout, account/**, order-lookup                                         | Dynamic, no cache                | —                                           |
| Admin/**                                                                         | Dynamic, `no-store`              | —                                           |

Cache tags (use exactly these): `products`, `product:{slug}`, `categories`, `brands`, `brand:{slug}`, `goals`, `ingredients`, `ingredient:{slug}`, `articles`, `article:{slug}`, `banners`, `settings`, `shipping`. Every admin mutation that touches public content calls `revalidateTag()` for the affected tags (helper `revalidatePublic(tags: string[])` in `lib/utils.ts`).

`generateStaticParams` prebuilds: top 200 products, all categories/brands/goals, published articles; everything else renders on demand then caches.

## 6. Supabase clients — exact usage rules

| Client               | File                                                       | Key     | Where used                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server (user ctx)    | `lib/supabase/server.ts` (`createServerClient` w/ cookies) | anon    | RSC reads, server actions — **default choice**                                                                                                                                                                                                                                                                                                      |
| Browser              | `lib/supabase/client.ts`                                   | anon    | client components needing realtime/auth state (rare)                                                                                                                                                                                                                                                                                                |
| Admin (service role) | `lib/supabase/admin.ts` (imports `server-only`)            | service | ONLY: payment webhooks; cron jobs; guest-cart ops keyed by `anon_token`; guest order lookup (number+email); email dispatch logging; auth-user provisioning in seed scripts; **GDPR erasure — scrubbing the GoTrue identity** (`customers/actions.ts`, M10); **team management — creating and banning a staff account** (`settings/actions.ts`, M10) |

Middleware refreshes the session per `@supabase/ssr` docs. Any new service-role usage must be added to this table via PR.

The two M10 entries are both GoTrue operations with no user-context equivalent — an anon-key
client cannot create, ban or re-address an auth user. Both are deliberately narrow: the service
client mints or scrubs the _identity_ only, and the **role** is written through the SSR client, so
`p_admin_update on profiles` and `prevent_role_escalation` still apply. Neither path can grant a
permission (docs/13 §P4, §P5).

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
