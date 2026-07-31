# SHNETA — Claude Code Project Guide

SHNETA is a production e-commerce wellness marketplace (supplements + education) for the Albanian-speaking market, launching in Kosovo. Stack: **Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · shadcn/ui · Supabase (Postgres + Auth + Storage) · TanStack Query · React Hook Form + Zod · Framer Motion · Resend · Vitest · Playwright · Vercel**.

## Documentation map (read before coding)

All specs live in `docs/`. Start every session by reading `docs/00-README.md`, then the doc(s) for the task:

| Task                                                                         | Read                                               |
| ---------------------------------------------------------------------------- | -------------------------------------------------- |
| Anything (first time)                                                        | `docs/00-README.md`, `docs/01-product-overview.md` |
| Project setup, folder structure, patterns                                    | `docs/02-architecture.md`                          |
| Database, migrations, RLS, RPCs                                              | `docs/03-database.md`                              |
| Styling, tokens, components                                                  | `docs/04-design-system.md`                         |
| Customer-facing pages                                                        | `docs/05-customer-pages.md`                        |
| Admin panel pages                                                            | `docs/06-admin-pages.md`                           |
| Cart, checkout, orders, payments, subscriptions, inventory, coupons, loyalty | `docs/07-commerce-logic.md`                        |
| Knowledge center, i18n content, SEO, emails                                  | `docs/08-content-seo-emails.md`                    |
| Tests, accessibility, performance                                            | `docs/09-quality-testing.md`                       |
| Envs, CI/CD, deployment, cron                                                | `docs/10-operations-deployment.md`                 |
| Seed data                                                                    | `docs/11-seed-data.md`                             |
| What to build next + acceptance criteria                                     | `docs/12-build-plan.md`                            |

Work through `docs/12-build-plan.md` milestone by milestone. Do not skip ahead; each milestone assumes the previous ones are merged and green.

## Commands

```bash
pnpm dev                 # local dev (http://localhost:3000)
pnpm build               # production build — must pass before completing a milestone
pnpm lint                # eslint
pnpm typecheck           # tsc --noEmit
pnpm test                # vitest unit tests
pnpm test:e2e            # playwright (requires local supabase + seeded db)
pnpm db:types            # regenerate src/lib/supabase/database.types.ts

supabase start                       # local stack
supabase db reset                    # re-apply all migrations + seed
supabase migration new <name>        # new migration file in supabase/migrations/
```

## Non-negotiable conventions

1. **TypeScript strict.** No `any`, no `@ts-ignore`, no non-null assertions to silence errors. Regenerate DB types after every migration.
2. **Money = integer cents, currency EUR.** Never floats, never string math. All money helpers in `src/lib/money.ts`. Prices are VAT-inclusive (see docs/07).
3. **i18n everywhere.** Locales: `sq` (default, no URL prefix) and `en` (`/en/...`) via next-intl. No hardcoded user-facing strings in storefront components — use message keys. DB content fields are jsonb `{ "sq": "...", "en": "..." }`; read with `pickLocale()` from `src/lib/i18n.ts`. Admin UI is English-only in v1.
4. **Mutations are Server Actions** in each feature's `actions.ts`, validated with Zod schemas from that feature's `schemas.ts`, returning `ActionResult<T>` (see docs/02 §7). Never mutate from client components directly against Supabase.
5. **RLS is the security boundary.** User-context reads/writes go through the SSR/browser Supabase clients (anon key) so RLS applies. The service-role client lives ONLY in `src/lib/supabase/admin.ts` (server-only) and is used ONLY for: webhooks, cron jobs, guest-cart/guest-order-lookup operations, and email sending — each usage listed in docs/02 §6. Never use it as a shortcut around a missing policy.
6. **Database changes only via migration files** in `supabase/migrations/` (SQL in docs/03 is the source of truth). Every table: RLS enabled, policies, `updated_at` trigger. Never edit schema in the dashboard.
7. **Server Components by default.** Add `'use client'` only for interactivity. Catalog/content pages are static/ISR with tag-based revalidation (docs/02 §5); cart/checkout/account/admin are dynamic.
8. **Naming:** files kebab-case, components PascalCase, functions/vars camelCase, DB snake_case, routes lower-kebab. Feature code lives in `src/features/<domain>/` (docs/02 §4).
9. **Design tokens only.** Colors, radii, shadows, fonts come from the Tailwind theme defined in docs/04. No arbitrary hex values or one-off font sizes in components.
10. **Slugs are immutable after publish.** Soft-delete (`deleted_at`) where the schema defines it; never hard-delete orders, customers, or audit rows.
11. **Every list/detail page ships loading, empty, and error states** (skeletons per docs/04 §9; empty states tell the user what to do next).
12. **Accessibility floor:** semantic HTML, keyboard operable, visible focus ring, labelled inputs, alt text, WCAG AA contrast.

## Definition of done (every milestone)

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.
- New/changed flows covered by the tests named in the milestone's acceptance criteria.
- Responsive at 360 px, 768 px, 1280 px; keyboard accessible; no console errors/warnings.
- All strings i18n'd (sq + en messages added); loading/empty/error states present.
- Migrations applied cleanly on `supabase db reset`; seed still works.

## Do NOT

- Add dependencies not listed in docs/02 without stating why in the PR/commit message.
- Introduce Prisma or any other ORM — this project is Supabase-native by decision (docs/00 §Decision log).
- Store cart state in localStorage as source of truth — the cart lives in the database (docs/07 §3).
- Call payment providers directly from components — always through the provider abstraction in `src/lib/payments/` (docs/07 §6).
- Commit `.env*`, service-role keys, or seed credentials.
- Invent copy that makes health claims ("cures", "treats", "prevents disease") — see docs/08 §7 compliance rules.
