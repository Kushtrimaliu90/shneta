# 10 · Operations & Deployment

## 1. Environments

| Env     | App                                  | Supabase                  | Purpose                                                                     |
| ------- | ------------------------------------ | ------------------------- | --------------------------------------------------------------------------- |
| local   | `pnpm dev`                           | `supabase start` (Docker) | development; `supabase db reset` reapplies migrations + `supabase/seed.sql` |
| staging | Vercel preview/staging domain        | project `shneta-staging`  | every PR preview points here; E2E target                                    |
| prod    | `shneta.com` (+ apex/`www` redirect) | project `shneta-prod`     | customers                                                                   |

Git flow: trunk-based; PR → checks + preview → squash-merge to `main` → auto-deploy staging path → manual promote to prod (Vercel "Promote" or protected `production` branch — pick one, document in repo). Migrations: committed SQL in `supabase/migrations/`; applied by CI to staging on merge (`supabase db push --linked` with staging ref) and to prod during promote (manual approval job). Never dashboard-edit schema.

## 2. CI (GitHub Actions `.github/workflows/ci.yml`)

Jobs on PR: (1) **quality** — pnpm install (cached), `check:i18n`, `typecheck`, `lint`, `test` (unit); (2) **integration+e2e** — start Supabase local, `db reset` (migrations+seed), `pnpm build`, run integration suite, `playwright install --with-deps`, run E2E against `next start`; upload traces/screenshots on failure; (3) **audit** — `pnpm audit --prod` (fail on critical). `main` additionally runs the staging migration job. Secrets via GitHub OIDC/environment secrets; no keys in logs.

## 3. Environment variables

| Var                                                                                                | Scope                   | Notes                               |
| -------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------- |
| NEXT_PUBLIC_SITE_URL                                                                               | all                     | absolute origin per env             |
| NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY                                           | all                     | public                              |
| SUPABASE_SERVICE_ROLE_KEY                                                                          | server only             | never NEXT_PUBLIC; Vercel encrypted |
| RESEND_API_KEY · EMAIL_FROM                                                                        | server                  | from = verified domain sender       |
| CRON_SECRET                                                                                        | server                  | bearer for /api/cron/*              |
| REVALIDATE_SECRET                                                                                  | server                  | on-demand ISR endpoint              |
| SENTRY_DSN (+ SENTRY_AUTH_TOKEN build)                                                             | all                     |                                     |
| BANK_POS_MERCHANT_ID / BANK_POS_SECRET / BANK_POS_BASE_URL                                         | server, when contracted | adapter                             |
| UPSTASH_REDIS_REST_URL/TOKEN                                                                       | optional                | only if Redis limiter chosen        |
| `.env.example` kept current; app fails fast on missing required vars (zod-validated `lib/env.ts`). |

## 4. Supabase configuration (per project)

Auth: email+password only v1; confirm email ON; secure email change ON; site URL + redirect URLs (local/staging/prod); auth email templates restyled (docs/08 §6); JWT expiry default; anonymous sign-ins OFF. Database: PITR/backups per plan (daily minimum; enable PITR on prod), `pg_trgm/citext/unaccent` via migration. Storage: create the five buckets (docs/03 §11) via migration/setup script with size+MIME limits. API: RLS everywhere (CI test asserts `rowsecurity` true on all public tables).

## 5. Vercel configuration

Framework Next.js; regions: `fra1` (closest to Kosovo). Image optimization remotePatterns → Supabase storage host. Headers in `next.config.ts`: HSTS (2 y, preload), X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy minimal, CSP (self + supabase + resend beacon none client-side + analytics domain; start report-only). Vercel Analytics + Speed Insights on. `vercel.json` crons:

```json
{
  "crons": [
    { "path": "/api/cron/subscriptions", "schedule": "0 5 * * *" },
    { "path": "/api/cron/review-requests", "schedule": "0 7 * * *" },
    { "path": "/api/cron/housekeeping", "schedule": "30 3 * * *" }
  ]
}
```

(05:00 UTC = 06/07:00 CET; housekeeping: abandon stale carts, cancel unpaid card orders > 24 h, purge rate_limits older than 2 d.) All cron routes verify `Authorization: Bearer CRON_SECRET`, are idempotent, and log a summary row (email_log-style or Sentry breadcrumb).

## 6. Monitoring & alerting

Sentry (errors + performance sampling 10%); alert rules: any checkout/webhook/cron error → immediate email/Slack; error-rate spike. Uptime: external ping on `/` and `/api/health` (simple route returning db `select 1`) every minute (Better Stack/UptimeRobot). Weekly review: Core Web Vitals (Vercel), zero-result searches (add lightweight logging Phase 2), low-stock report. Admin dashboard doubles as business monitor.

## 7. Backups & recovery

Supabase automated backups + PITR (prod). Quarterly restore drill to a scratch project (documented runbook in repo `runbooks/restore.md`). Storage: buckets are the only binary store; enable Supabase storage backups or scheduled `rclone` export (Phase 2 acceptable). Config export: settings table included in DB backups; env vars documented in the table above.

## 8. Analytics & consent

Privacy-friendly analytics (Plausible or Vercel Analytics custom events) gated by the consent banner; events: page views, add_to_cart, begin_checkout, purchase (order id + value), subscribe_created, finder_completed, search. No ad pixels v1. Consent stored in cookie; banner links to privacy page.

## 9. Launch checklist

Domain + DNS + www redirect + HTTPS · Resend domain verified (SPF, DKIM, DMARC quarantine) and test sends to Gmail/Outlook land in inbox · prod env vars set + `lib/env.ts` passes · migrations applied, seed of **real** catalog loaded (not demo), admin + staff accounts created with strong passwords + role rows verified · legal pages final (terms, privacy, shipping/returns) reviewed · compliance disclaimer present on required surfaces · cookie consent live · sitemap submitted to Search Console (sq + en, hreflang validated) · Lighthouse ≥ 95 on Home/PLP/PDP prod · E2E suite green against staging with prod-like data · RLS matrix green · backup + restore drill done once · Sentry alerts firing test · uptime monitor active · order confirmation → delivery flow rehearsed end-to-end with a real test order including courier handoff · rollback plan: Vercel instant rollback + migration down-scripts for the last release.
