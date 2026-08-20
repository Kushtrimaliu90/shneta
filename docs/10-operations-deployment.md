# 10 · Operations & Deployment

## 1. Environments

| Env     | App                                   | Supabase                  | Purpose                                                                     |
| ------- | ------------------------------------- | ------------------------- | --------------------------------------------------------------------------- |
| local   | `pnpm dev`                            | `supabase start` (Docker) | development; `supabase db reset` reapplies migrations + `supabase/seed.sql` |
| staging | Vercel preview/staging domain         | project `biocode-staging` | every PR preview points here; E2E target                                    |
| prod    | `biocode.com` (+ apex/`www` redirect) | project `biocode-prod`    | customers                                                                   |

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

## 4.1 Social sign-in providers

The code ships dark. Nothing appears on the auth pages until `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`, so these steps can be done at any time without a deploy waiting on them.

**Google** — free, about an hour, no Google review needed (email and profile are not sensitive scopes):

1. Google Cloud Console -> new or existing project -> **APIs & Services -> OAuth consent screen**. User type **External**, then **Publish**. It asks for an app name, a support email, a homepage, a privacy policy URL and a terms URL: use `https://biocode.fit`, `https://biocode.fit/legal/privacy`, `https://biocode.fit/legal/terms`.
2. **Credentials -> Create credentials -> OAuth client ID**, type **Web application**.
3. Authorised redirect URI — this is **Supabase's callback, not ours**:
   `https://<project-ref>.supabase.co/auth/v1/callback`
   Our own `/api/auth/callback` is registered separately, in step 5.
4. Copy the client ID and secret into **Supabase -> Authentication -> Providers -> Google**, and enable it.
5. Confirm **Supabase -> Authentication -> URL Configuration** lists `https://biocode.fit/api/auth/callback` under Redirect URLs. It should already, because email confirmation uses the same handler.
6. Set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` in Vercel (Production, Preview) and redeploy. It is a `NEXT_PUBLIC_` variable, so it is inlined at build time — changing it needs a rebuild, not just a restart.
7. Apply the pending migration (`pnpm db:push`) so a provider-supplied name lands on the profile. Google alone works without it; the migration is what stops the next provider arriving nameless.

Verify in this order, because each step fails differently: the button appears -> Google shows an account chooser -> you land back on `/account` signed in -> `profiles` has a row with your name and a `referral_code`.

**Apple** — not enabled. Budget for it before promising it: a $99/year Apple Developer membership, a Services ID, a domain-association file served from `/.well-known/`, a client secret that is a JWT expiring every six months and must be rotated, and registration of the Resend sending domain with Apple's private email relay or **order confirmations bounce** for anyone who hides their address. The code change itself is one entry in `OAUTH_PROVIDERS`.

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

**As built**, `vercel.json` carries four: `housekeeping` (03:30), `payouts` (04:15), `referrals`
(04:45) and `subscriptions` (05:00). Spaced fifteen minutes apart so a slow run cannot overlap the next,
and ordered cheapest-first. `review-requests` from the spec above was folded into `housekeeping`.

`referrals` (docs/17 §3) runs four passes daily: expire links whose twelve months are up, auto-approve
flag-free links whose referee has a delivered order (off by default), post the month's points **on the
1st only**, then send the T−30 and T−7 expiry notices. Two things worth knowing when reading its logs:

- The posting pass is a **true-up** — it pays the difference between what the earnings ledger says a
  referrer has earned and what their wallet already holds — so a replayed invocation pays nothing the
  second time. `pointsPosted: 0` on a re-run is the correct outcome, not a failure.
- It is restricted to the 1st **by choice, not by safety**. Running it daily would be harmless
  arithmetically and would produce one ledger row per referrer per day, which is the purchase timeline
  docs/17 §0.2 exists to avoid publishing to the referrer.

## 6. Monitoring & alerting

Sentry (errors + performance sampling 10%); alert rules: any checkout/webhook/cron error → immediate email/Slack; error-rate spike. Uptime: external ping on `/` and `/api/health` (simple route returning db `select 1`) every minute (Better Stack/UptimeRobot). Weekly review: Core Web Vitals (Vercel), zero-result searches (add lightweight logging Phase 2), low-stock report. Admin dashboard doubles as business monitor.

## 7. Backups & recovery

Supabase automated backups + PITR (prod). Quarterly restore drill to a scratch project (documented runbook in repo `runbooks/restore.md`). Storage: buckets are the only binary store; enable Supabase storage backups or scheduled `rclone` export (Phase 2 acceptable). Config export: settings table included in DB backups; env vars documented in the table above.

## 8. Analytics & consent

Privacy-friendly analytics (Plausible or Vercel Analytics custom events) gated by the consent banner; events: page views, add_to_cart, begin_checkout, purchase (order id + value), subscribe_created, finder_completed, search. No ad pixels v1. Consent stored in cookie; banner links to privacy page.

## 9. Launch checklist

Domain + DNS + www redirect + HTTPS · Resend domain verified (SPF, DKIM, DMARC quarantine) and test sends to Gmail/Outlook land in inbox (`pnpm email:test you@gmail.com`) · prod env vars set + `lib/env.ts` passes · migrations applied, seed of **real** catalog loaded (not demo), admin + staff accounts created with strong passwords + role rows verified · legal pages final (terms, privacy, shipping/returns) reviewed · compliance disclaimer present on required surfaces · cookie consent live · sitemap submitted to Search Console (sq + en, hreflang validated) · Lighthouse ≥ 95 on Home/PLP/PDP prod · E2E suite green against staging with prod-like data · RLS matrix green · backup + restore drill done once · Sentry alerts firing test · uptime monitor active · order confirmation → delivery flow rehearsed end-to-end with a real test order including courier handoff · rollback plan: Vercel instant rollback + migration down-scripts for the last release.
