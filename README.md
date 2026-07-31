# SHNETA

Multi-brand wellness marketplace for the Albanian-speaking market, launching in Kosovo.
Supplements plus an education layer, bilingual (sq/en), Cash-on-Delivery first.

**The specification is the source of truth, not this file.** Start at
[`CLAUDE.md`](CLAUDE.md), then [`docs/00-README.md`](docs/00-README.md). Corrections applied
to the pack during implementation are recorded in
[`docs/13-spec-corrections.md`](docs/13-spec-corrections.md) — read it before touching the
database or the design tokens.

## Stack

Next.js 15 (App Router, RSC-first) · React 19 · TypeScript strict · Tailwind CSS v4 ·
Supabase (Postgres + Auth + Storage, RLS everywhere) · next-intl · Zod ·
React Hook Form · Framer Motion · Resend · Vitest · Playwright · Vercel.

No ORM by decision (`docs/00` §Decision log #2). Money is integer cents, EUR.

## Getting started

```bash
corepack enable pnpm
pnpm install
cp .env.example .env.local        # defaults already point at the local Supabase stack
pnpm dev                          # http://localhost:3000  (Albanian) · /en (English)
```

The app boots without a database — `.env.local` only needs to parse. To bring up the
schema (requires Docker):

```bash
supabase start
supabase db reset                 # applies the 13 migrations + seed.sql
pnpm db:types                     # regenerate src/lib/supabase/database.types.ts
pnpm test:integration             # RLS matrix, checkout RPC, order lifecycle
```

### Hosted dev project

The schema is **applied and verified** on the hosted dev project
`rszbpdgfvyofvmuishmn` (eu-west-1, Postgres 17.6): all 13 migrations, the seed, and
**45/45 integration tests green against the live database**. See
[`runbooks/supabase-setup.md`](runbooks/supabase-setup.md) for the procedure and for the
dashboard settings the CLI cannot push.

To work against it, put the project URL plus the `anon` and `service_role` keys in
`.env.local` (never committed), then:

```bash
pnpm db:link                      # already linked if supabase/.temp exists
pnpm db:diff                      # dry-run: what would be pushed
pnpm db:push                      # apply pending migrations
pnpm db:types:linked              # regenerate types from the live schema
pnpm test:integration             # ~55s — creates and deletes real rows
```

`pnpm test:integration` **writes to whatever `.env.local` points at**. Point it at a
disposable database, never production.

## Commands

| Command                     | What it does                                                               |
| --------------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`                  | Local dev server                                                           |
| `pnpm verify`               | **The gate.** i18n → sql → types → lint → unit → build → bundle            |
| `pnpm typecheck`            | `tsc --noEmit`                                                             |
| `pnpm lint` / `pnpm format` | ESLint (flat config) / Prettier                                            |
| `pnpm test`                 | Vitest unit suite                                                          |
| `pnpm test:integration`     | Vitest against a live local Supabase (RLS, RPCs, lifecycle)                |
| `pnpm test:e2e`             | Playwright (needs a build; boots `next start` itself)                      |
| `pnpm check:i18n`           | Fails if sq and en key sets, shapes or ICU placeholders diverge            |
| `pnpm check:sql`            | Offline structural check on the migrations                                 |
| `pnpm check:bundle`         | Enforces the 170 kB gz First Load JS budget (docs/09 §3)                   |
| `pnpm purge:test-data`      | Removes integration fixtures (the suite does this automatically)           |
| `pnpm purge:demo`           | Removes the 24 demo products and test coupons — pre-launch, see docs/14 §7 |
| `pnpm seed:users`           | Creates the seven fixture staff/customer accounts (docs/11 §2)             |
| `pnpm db:types`             | Regenerate DB types from the local stack                                   |

Run `pnpm verify` before calling a milestone done; it is the same sequence CI runs.

## Layout

```
docs/            the specification pack (15 documents)
src/
  app/[locale]/  storefront — sq unprefixed, en under /en
  app/admin/     admin panel — deliberately NOT localized
  components/    ui (shadcn primitives) · storefront · admin · shared
  features/      one folder per domain: actions.ts queries.ts schemas.ts types.ts
  lib/           dependency leaf — money, i18n, supabase clients, env, motion, utils
  i18n/          routing, request config, messages/{sq,en}.json
supabase/        migrations + seed
tests/unit/      Vitest · e2e/ Playwright
```

Import rules, enforced by ESLint: `features/*` never imports from `app/`; `lib/` imports
from neither. Use the `@/` alias, not deep relative paths.

## Conventions that are not negotiable

The full list is in `CLAUDE.md`. The ones that bite hardest:

1. **Money is integer cents.** All helpers in `src/lib/money.ts`. The totals algorithm there
   mirrors the `checkout_create_order` RPC line for line, and `tests/unit/money.test.ts`
   asserts parity — change one, change both, in the same commit.
2. **RLS is the security boundary.** Reads and writes go through the SSR/browser clients so
   policies apply. `src/lib/supabase/admin.ts` is service-role and its callers are a closed
   list (docs/02 §6). It is never a shortcut around a missing policy.
3. **Mutations are Server Actions** returning `ActionResult<T>`, validated with the
   feature's Zod schema.
4. **No hardcoded user-facing strings.** Both message files change together or CI fails.
5. **Design tokens only.** Colours, radii and type come from `src/styles/globals.css`. The
   palette is contrast-tested in `tests/unit/contrast.test.ts` — `ink-400` and `line` are
   below AA and are decorative-only; use `ink-500` and `line-strong` for text and controls.
   One exception worth memorising: on a `forest-50` tint (selected cards, filled panels)
   `ink-500` measures 4.43:1 and misses AA, so **secondary text on a tint is `ink-600`**.

## Status

| Milestone                     | State                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 · Scaffold and foundations | ✅ **Done and verified** — tokens, i18n, lib layer, CI, bundle budget gate                                                                        |
| M1 · Database and seed        | ✅ **Applied and verified** — 13 migrations + 24-product catalogue + coupons live on `rszbpdgfvyofvmuishmn`; 45/45 integration tests              |
| M2 · Auth and account shell   | ✅ **Done** — sign up/in/out, password reset, account overview and settings                                                                       |
| M3 · Catalogue browse         | 🟡 **Nearly done** — PLP, categories, PDPs, brands, goals, ingredients, home, JSON-LD. Knowledge and offers remain (both need article content)    |
| M4 · Cart and COD checkout    | ✅ **Done** — guest cart, cart page, four-step checkout, token-gated success page, guest order lookup. Confirmation email needs a Resend key      |
| M5 · Orders ops and admin     | ✅ **Done** — admin shell, order queue and detail, state machine, shipment, refund, lifecycle emails, dashboard, print docs, customer order pages |
| M6 → M11                      | Not started — see `docs/12-build-plan.md`                                                                                                         |
| Deployment pipeline           | ✅ **Ready** — health check, sitemap, cron, ISR purge, Sentry, `vercel.json`, budget gate. See `runbooks/deploy.md`                               |

Current test totals: **97 unit · 45 integration against the live database · 156 E2E** across
desktop and a 390 px viewport, with axe clean on every page built so far.

**A guest can now buy something end to end and pay cash on delivery** — add to cart, four-step
checkout, order written by the `checkout_create_order` transaction, success page gated on an
access token rather than the order number, and order lookup by number plus email.

**And staff can now fulfil it.** Sign in at `/admin` and work the queue: confirm, ship with
tracking, deliver, cancel with a reason, refund. Every mutation writes an audit row, and every
transition is enforced by the database rather than by the UI.

**What is left before real customers: the catalogue and the email.** Products can only be created
by SQL until M6, so the shop still sells 24 demo fixtures; and the transactional emails record
`skipped_no_provider` until a Resend key and a verified sending domain exist. [`docs/14-launch-readiness.md`](docs/14-launch-readiness.md) is the
honest ledger of what is done, what is outstanding, and which items are owner tasks rather
than code; [`docs/13 §I`](docs/13-spec-corrections.md) records the eight defects that driving
the checkout in a real browser found after the code had already passed every offline gate.

Still outstanding in M1: `scripts/seed-users.ts`, and therefore review fixtures — ratings
read 0 until users exist. Product images are absent by choice, so the branded fallback tile
is what renders.
