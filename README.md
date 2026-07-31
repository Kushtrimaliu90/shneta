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
supabase db reset                 # applies the 12 migrations + seed.sql
pnpm db:types                     # regenerate src/lib/supabase/database.types.ts
pnpm test:integration             # RLS matrix, checkout RPC, order lifecycle
```

### Hosted dev project

The schema is **applied and verified** on the hosted dev project
`rszbpdgfvyofvmuishmn` (eu-west-1, Postgres 17.6): all 12 migrations, the seed, and
**44/44 integration tests green against the live database**. See
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

| Command                     | What it does                                                     |
| --------------------------- | ---------------------------------------------------------------- |
| `pnpm dev`                  | Local dev server                                                 |
| `pnpm verify`               | **The gate.** i18n → sql → typecheck → lint → unit tests → build |
| `pnpm typecheck`            | `tsc --noEmit`                                                   |
| `pnpm lint` / `pnpm format` | ESLint (flat config) / Prettier                                  |
| `pnpm test`                 | Vitest unit suite                                                |
| `pnpm test:integration`     | Vitest against a live local Supabase (RLS, RPCs, lifecycle)      |
| `pnpm test:e2e`             | Playwright (needs a build; boots `next start` itself)            |
| `pnpm check:i18n`           | Fails if sq and en key sets, shapes or ICU placeholders diverge  |
| `pnpm check:sql`            | Offline structural check on the migrations                       |
| `pnpm db:types`             | Regenerate DB types from the local stack                         |

Run `pnpm verify` before calling a milestone done; it is the same sequence CI runs.

## Layout

```
docs/            the specification pack (13 documents)
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

## Status

| Milestone                     | State                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| M0 · Scaffold and foundations | ✅ **Done and verified** — 71 unit tests, 8 E2E incl. axe on both locales, 120 kB First Load JS against a 170 kB budget     |
| M1 · Database and seed        | ✅ **Applied and verified** — 12 migrations + seed live on `rszbpdgfvyofvmuishmn`; 44/44 integration tests green against it |
| M2 → M11                      | Not started — see `docs/12-build-plan.md`                                                                                   |

M1 is functionally complete. What remains is fixture data, not schema: the demo catalogue
(docs/11 §6–§9 — 30 ingredients, 24 products, 6 articles, order fixtures) and
`scripts/seed-users.ts`. `supabase/seed.sql` ends with the exact outstanding list. The
config and taxonomy it does seed — settings, warehouse, shipping methods, certifications,
13 categories, 16 health goals, 8 brands, legal page skeletons — are
production-appropriate and idempotent.
