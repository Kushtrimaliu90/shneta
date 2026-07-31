# SHNETA Specification Pack — README

**Version 2.0 (Final, build-ready) · Supersedes the v1.0 single-document SRS draft**

This pack is the complete specification for building SHNETA to production. It is written for AI coding agents (Claude Code first) and human developers. It replaces the earlier "250–400 page single document" plan deliberately: one giant document is the wrong artifact for agentic development. Agents work best with **modular, task-scoped documents** they can load selectively — that is what this pack is.

## What's in the pack

```
CLAUDE.md                       ← agent guide, conventions, doc map (repo root)
docs/
  00-README.md                  ← this file: decision log + how to build
  01-product-overview.md        ← vision, scope, users, roles, NFRs, metrics
  02-architecture.md            ← final stack, folder structure, patterns
  03-database.md                ← full schema SQL, RLS, functions, storage
  04-design-system.md           ← tokens, typography, components, motion
  05-customer-pages.md          ← every customer page, section by section
  06-admin-pages.md             ← every admin page
  07-commerce-logic.md          ← pricing, cart, checkout, orders, payments,
                                  subscriptions, coupons, loyalty, inventory
  08-content-seo-emails.md      ← knowledge center, i18n, SEO, transactional email
  09-quality-testing.md         ← test strategy, a11y, performance budgets
  10-operations-deployment.md   ← environments, CI/CD, cron, monitoring, launch
  11-seed-data.md               ← concrete seed content
  12-build-plan.md              ← 12 milestones with acceptance criteria
```

**Precedence:** if documents ever conflict: `03-database.md` wins on data, `07-commerce-logic.md` wins on business rules, `02-architecture.md` wins on code structure, `CLAUDE.md` wins on conventions.

**Language:** MUST = mandatory for v1. SHOULD = strongly recommended, skip only with a stated reason. MAY / Future = out of v1 scope.

## Decision log — changes from the v1.0 draft (and why)

These are the deliberate corrections made while finalizing. They are decisions, not options; the rest of the pack assumes them.

1. **One monolith → modular doc pack.** A 300-page document overflows agent context and buries the schema. Each doc here is loadable independently and mapped to tasks in `CLAUDE.md`.
2. **Prisma removed from the stack.** Prisma + Supabase creates two migration systems and typically connects with the service role, silently bypassing Row Level Security — the opposite of the draft's own security requirements. Final approach: **Supabase migrations + generated TypeScript types + Zod at the boundaries.** One schema source of truth, RLS everywhere.
3. **Payments made real for Kosovo.** Stripe does not serve Kosovo-domiciled businesses, so "Stripe-ready" alone would block launch. Final approach: a **`PaymentProvider` abstraction** with (a) **Cash on Delivery** fully implemented at launch — it is the dominant payment method in the market, (b) a **local bank virtual-POS adapter** (redirect + callback pattern used by Kosovo acquiring banks) specified and stubbed for the acquirer contract you sign, (c) a **Stripe adapter slot** for a future EU entity / diaspora expansion. See docs/07 §6.
4. **Currency: EUR only at launch,** stored as integer cents. Kosovo's currency is the euro; multi-currency (ALL, MKD) is schema-ready (`currency` columns everywhere) but deferred — see roadmap in docs/01 §8.
5. **Tax model fixed:** consumer prices are **VAT-inclusive**; VAT (default 18%, configurable in settings) is broken out informationally on orders/invoices. Draft was silent on this; it changes every price calculation. See docs/07 §5.
6. **i18n made concrete:** `sq` default (no URL prefix) + `en` (`/en`), via next-intl; translatable DB content stored as jsonb per-locale objects. Additional locales (de for diaspora, mk, sr) are additive later.
7. **Subscriptions adapted to a COD market.** Card-on-file autobilling doesn't exist without a card gateway, so v1 subscriptions are **scheduled repeat orders**: the system generates the order on schedule, notifies the customer 3 days ahead with skip/pause controls, and the customer pays on delivery (or by card once the POS adapter is live). See docs/07 §8.
8. **Search:** Postgres full-text search + trigram (typo tolerance) at launch; documented upgrade path to Meilisearch when the catalog or query volume demands it. No external search dependency on day one.
9. **Checkout is a single atomic Postgres function** (`checkout_create_order` RPC): totals computed server-side from DB prices, stock decremented, coupon redeemed, order + items + payment created in one transaction. Eliminates the classic race conditions (price tampering, oversell). See docs/03 §8 and docs/07 §4.
10. **Guest carts** use a secure httpOnly cookie token mapped to a DB cart row (not localStorage), so guest → login cart merge and abandoned-cart data work. See docs/07 §3.
11. **Admin UI is English-only in v1** (internal team, faster build); the storefront is fully bilingual. Admin i18n is a later toggle.
12. **Scope sequencing:** everything in the draft's v1 list is specified, but the build plan sequences it by risk: browse → buy (COD) → operate (admin orders/catalog) → engage (reviews, wishlist, search) → knowledge/SEO → subscriptions/loyalty/finder → inventory & compliance workflows → hardening. If launch pressure hits, Milestones 9–10 features are the designated cut line (docs/12).
13. **Added the ~80% the draft didn't contain:** complete database schema with RLS policies, page-by-page UI specs (customer + admin), the commerce rule book, server-action contracts, seed data, test plan, CI/CD, and milestone acceptance criteria.

## How to build this with Claude Code

1. Create an empty git repo. Copy `CLAUDE.md` to the repo root and the `docs/` folder alongside it. Commit.
2. Open a terminal in the repo and start Claude Code (see https://docs.claude.com/en/docs/claude-code/overview for install/setup).
3. Kick off with:
   > Read CLAUDE.md and docs/00-README.md, then docs/12-build-plan.md. Execute **Milestone 0** exactly as specified. Show me your plan before writing code.
4. Proceed **one milestone per session** (M1 and M5 may need two). For each: let it plan first, review the plan against the milestone's acceptance criteria, then let it build. Run the Definition of Done checks from `CLAUDE.md` before accepting.
5. Commit at every green milestone. If a session drifts, restart it — the docs are the memory, not the chat.
6. When something is ambiguous, the agent must follow doc precedence (above) and record any judgment call in the commit message; you review those.

## Human owner responsibilities (things no agent can do)

- Create the Supabase projects (staging + prod), Vercel project, Resend account and verified sending domain; put keys in the env vars listed in docs/10.
- Sign the acquiring-bank virtual-POS contract when ready (docs/07 §6.3) and provide its credentials/spec to implement the adapter.
- Provide final logo files, brand product data, real product photography, and lab reports.
- Review compliance copy (docs/08 §7) with your legal/regulatory contact — supplements advertising rules apply.
- Approve the launch checklist in docs/10 §9.
