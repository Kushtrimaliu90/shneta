# Runbook · Deploy

Trunk-based, per `docs/10 §1`: PR → checks + preview → squash-merge to `main` → staging →
**manual** promote to production.

Read [`docs/14-launch-readiness.md`](../docs/14-launch-readiness.md) first. The pipeline is
production-ready and the store now takes and fulfils orders (M5). What it still lacks before
real customers: verified transactional email, legal copy, and a real catalogue in place of the
demo fixtures — see docs/14 §6 and §7. Deploy behind Vercel Protection until those are done.

---

## 1 · One-time Vercel setup

Import the GitHub repo at [vercel.com/new](https://vercel.com/new). Framework auto-detects
as Next.js; `vercel.json` supplies the region (`fra1`, closest to Kosovo) and the cron.

**Build settings** — the defaults are correct. Install runs `pnpm install --frozen-lockfile`
because `packageManager` is pinned in `package.json`.

### Environment variables

Set these per environment (Production / Preview / Development). `lib/env.server.ts` and
`lib/env.client.ts` validate at boot, so a missing required variable fails the deploy
loudly instead of 500-ing later.

| Variable                                              | Prod                  | Preview         | Notes                                                    |
| ----------------------------------------------------- | --------------------- | --------------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                                | `https://biocode.fit` | preview URL     | Drives canonicals, hreflang, `robots.txt`, sitemap       |
| `NEXT_PUBLIC_SUPABASE_URL`                            | prod project          | staging project |                                                          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                       | prod                  | staging         | Public by design                                         |
| `SUPABASE_SERVICE_ROLE_KEY`                           | prod                  | staging         | **Secret.** Bypasses RLS. Never `NEXT_PUBLIC_`           |
| `CRON_SECRET`                                         | ✔                     | ✔               | Vercel sends it as `Authorization: Bearer` automatically |
| `REVALIDATE_SECRET`                                   | ✔                     | ✔               | 32+ random chars                                         |
| `SENTRY_DSN`                                          | ✔                     | ✔               | Omit and Sentry is inert                                 |
| `NEXT_PUBLIC_SENTRY_DSN`                              | ✔                     | ✔               | Browser reporting; loads lazily                          |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | ✔                     | —               | Source-map upload only                                   |
| `RESEND_API_KEY` / `EMAIL_FROM`                       | M4+                   | M4+             | No email is sent before M4                               |

Generate secrets with `openssl rand -base64 32`.

> **Preview deployments must not point at production Supabase.** Every PR preview would
> then write to real data, and `pnpm test:integration` writes to whatever it is aimed at.

### Domain: `biocode.fit`, registered at Cloudflare, hosted on Vercel

A normal split — Cloudflare is the registrar and authoritative DNS, Vercel serves the app.
Nothing in the codebase cares, because the domain reaches the app only through
`NEXT_PUBLIC_SITE_URL`.

1. **Vercel → Project → Settings → Domains → Add** `biocode.fit` and `www.biocode.fit`.
   Vercel prints the records it wants.
2. **Cloudflare → DNS → Records.** Add what Vercel asked for — normally an `A` record on the
   apex to Vercel's anycast address and a `CNAME` on `www` to `cname.vercel-dns.com`.
3. **Set both records to "DNS only" (grey cloud), not "Proxied" (orange).**

   This is the one step that goes wrong, and it fails in a way that looks like something
   else. With Cloudflare's proxy on:
   - Cloudflare terminates TLS, so Vercel cannot complete its own certificate challenge and
     the domain sits on "Invalid Configuration" indefinitely;
   - two CDNs cache in series, so an ISR purge clears Vercel and Cloudflare keeps serving the
     old page — a price change appears not to have worked;
   - the client IP arrives as Cloudflare's, so `limitByIp` rate-limits the whole country as
     one visitor. Checkout is 10/hour (docs/02 §9). That is a checkout outage.

   Vercel is already a CDN. Proxying adds nothing here and breaks three things.

4. **SSL/TLS mode: Full (strict)** if you ever do turn the proxy on. Never "Flexible" —
   it serves the site over HTTP to the origin and breaks `Secure` cookies, which is every
   auth and cart cookie this app sets.
5. Wait for Vercel to show **Valid Configuration**, then set
   `NEXT_PUBLIC_SITE_URL=https://biocode.fit` in Production and redeploy. It is read at build
   time, so the redeploy is required — without it `robots.txt`, the sitemap and every
   canonical still point at the old host.

### Email lives on the same domain

Resend must verify **biocode.fit**, and its SPF/DKIM/DMARC records go in the same Cloudflare
DNS zone. Those are TXT records and are safe to leave proxy-off (TXT cannot be proxied).
`EMAIL_FROM` then has to be an address on that domain — a `From:` on an unverified domain is
delivered to spam, which for an order confirmation is the same as not sending it.

---

## 2 · Per-release

```bash
pnpm verify              # i18n → sql → typecheck → lint → unit → build
pnpm test:integration    # needs a database; purges its own fixtures on teardown
pnpm test:e2e            # needs a build
```

Then open a PR. CI runs the same three jobs. Merge to `main` deploys staging.

### Migrations

Schema changes ship **before** the code that depends on them, so a rollback of the app
never leaves the database ahead of it:

```bash
pnpm db:diff             # dry run — what would be applied
pnpm db:push             # apply to the linked project
pnpm db:types:linked     # regenerate types; commit the result
```

Write migrations additively (add a nullable column, backfill, then constrain) so the
previous release keeps working during the window where both are live.

### Promote to production

Vercel → Deployments → the staging build → **Promote to Production**. Apply migrations to
the production Supabase project first (`supabase link --project-ref <prod>` then
`pnpm db:push`).

---

## 3 · Post-deploy smoke test

```bash
BASE=https://biocode.fit

curl -s $BASE/api/health                     # {"status":"ok","database":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" $BASE/            # 200, lang="sq"
curl -s -o /dev/null -w "%{http_code}\n" $BASE/en          # 200, lang="en"
curl -s -o /dev/null -w "%{http_code}\n" $BASE/sitemap.xml # 200
curl -s $BASE/robots.txt | grep Sitemap                    # absolute prod URL
curl -sI $BASE/ | grep -iE 'x-frame-options|strict-transport|content-security'
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/cron/housekeeping   # 401 without token
```

Also confirm in the Vercel dashboard: the cron is registered, and the function region is
`fra1`.

**Do not run the E2E suite against production.** The line that used to be here —
`E2E_BASE_URL=https://biocode.fit pnpm test:e2e` — works, and that is the problem. `playwright.config.ts`
honours the variable, so the full suite drives a real browser through the real shop: it places and cancels
real orders, creates fixture products and brands that render in the live catalogue for the twenty-five
minutes it runs, and costs several deploys' worth of page rebuilds. CI already runs the same suite on every
push against a local database, so the production run adds no coverage at all.

The suite runs against `pnpm start` on `127.0.0.1:3000`. After a deploy, stop at the smoke test above.

---

## 4 · Rollback

**App** — Vercel → Deployments → previous build → _Promote to Production_. Instant, no
rebuild.

**Database** — migrations have no down-scripts by convention (`docs/10 §9` asks for them per
release). Because migrations ship ahead of code and additively, an app rollback is normally
sufficient on its own. If the schema itself must go back:

1. Write a forward migration that reverses the change. Never edit an applied migration file
   and never edit schema in the dashboard (`CLAUDE.md §6`) — a dashboard change is invisible
   to the next `db push` and will drift.
2. For data loss, restore from PITR into a scratch project first, extract, then reconcile.
   Never restore straight over production.

---

## 5 · Alert routing (`docs/10 §6`)

- Sentry: immediate alert on any error in `/api/webhooks/*`, `/api/cron/*`, or the checkout
  path. These are the money paths.
- Uptime monitor on `/` and `/api/health`, every minute.
- Error-rate spike alert.

Verify alerting actually fires before relying on it — an untested alert is not an alert.

---

## 6 · Known constraints

- **Vercel Hobby allows 2 cron jobs, daily only.** One is declared today. M7 adds
  review-requests and M9 adds subscriptions, which takes it to three — **Pro is required by
  M9** (`docs/13 §D8`).
- **CSP ships as `Content-Security-Policy-Report-Only`** (`docs/10 §5`). Watch the reports
  for a week, then rename the header in `next.config.ts` to enforce. `style-src` keeps
  `'unsafe-inline'` deliberately: the nonce alternative forces dynamic rendering and would
  defeat the ISR strategy in `docs/02 §5` (`docs/13 §F3`).
- **Only the housekeeping cron route exists.** Declaring crons for routes that do not exist
  yet would generate 404s and alert noise, so they are added with their milestones.

---

## 5 · Moving the domain (done once, for `shtrejt.com` → `biocode.fit`)

Kept because a domain move is exactly the kind of task that is done under time pressure with half
the steps remembered, and because the **order matters**: three of these break the live site if run
early.

### What is already done in the code

Nothing here needs a code change. The work below is dashboards and DNS.

- Everything that links somewhere derives from `NEXT_PUBLIC_SITE_URL`: canonicals, hreflang,
  `robots.txt`, `sitemap.xml`, auth callbacks, the links in every email template.
- The two display-only hostnames that used to be literals — the invoice/packing-slip header and the
  SEO preview in the product editor — read it too, via `lib/site.ts`.
- The contact address in the legal pages, `settings.store.email` and the BIOCODE brand's website are
  content: moved by `supabase/seeds/14-domain-biocode-fit.sql`, and the source seeds (06, 07, 12,
  `seed.sql`) were edited so a fresh `db reset` produces the new domain too.

### The order, and why

**1 · Own the domain.** Registrar of choice; Cloudflare if you want DNS and registration together.

**2 · Add it to Vercel** → Settings → Domains → Add `biocode.fit` and `www.biocode.fit`. Set the
apex as **primary** and `www` as a redirect to it. Add the DNS records Vercel prints, **DNS-only /
grey cloud** if the zone is on Cloudflare — see §1 for the three separate things the orange cloud
breaks, one of which is a checkout outage.

Both domains now serve the app. Nothing has changed for a visitor yet.

**3 · Supabase → Authentication → URL Configuration.** Set Site URL to `https://biocode.fit` and add
it to the redirect allowlist, keeping `shtrejt.com` in the list for now.

> **Before step 4, not after.** Password resets and email confirmations are built as
> `${NEXT_PUBLIC_SITE_URL}/api/auth/callback`, and Supabase refuses to redirect to a URL that is not
> allowlisted. Flip the variable first and every reset link in flight dies silently — the customer
> clicks and lands on an error, which reads as a broken account rather than a misconfigured allowlist.

**4 · Resend → Domains → Add `biocode.fit`**, put the SPF/DKIM/DMARC TXT records in DNS, wait for
Verified. Only then change `EMAIL_FROM` to `BIOCODE <porosite@biocode.fit>`.

> Sending from an address on a domain Resend has not verified is worse than not sending: the mail is
> accepted, then filed as spam, so `email_log` says `sent` and the customer has no confirmation.
> Keep the old `EMAIL_FROM` until the new domain is Verified, then switch — the two are independent.

**5 · Flip `NEXT_PUBLIC_SITE_URL` to `https://biocode.fit`** in Vercel → Production, and
**redeploy**. It is read at build time, so without the redeploy the canonicals, the sitemap and
`robots.txt` all still name the old host.

> No trailing slash. `z.url()` accepts one and every consumer builds `${origin}/path`, which put
> `https://www.shtrejt.com//` in the live sitemap as the canonical home page — the parser strips it
> now, but a value that needs stripping is still a value somebody typed wrong (docs/13 §20).

**6 · Redirect the old domain.** In Vercel → Domains, edit `shtrejt.com` and `www.shtrejt.com` to
**Redirect to `biocode.fit`**, permanent (308). Keep them attached — do not remove them:

- every link on the internet to a product page still resolves, with the path preserved;
- Google transfers the ranking signals it has accumulated, which is the entire point of a 301/308
  rather than a fresh start;
- customers who bookmarked an order-lookup URL still get to their order.

Keep the redirect for **at least a year**, and keep the registration for as long as anybody might
still click an old link — the cost is a renewal fee against losing traffic you already earned.

**7 · Google Search Console.** Add `biocode.fit` as a property, verify, submit `sitemap.xml`. Then on
the **old** property use **Settings → Change of address** and point it at the new one. That tells
Google the move is deliberate rather than a mass 404, and it is the difference between a two-week
transfer and a two-month one.

**8 · Update the store contact address** if the mailbox is changing too: `info@biocode.fit` has to
receive mail before the legal pages tell customers to write to it. Seed 14 already changed what the
pages say; MX records for the new domain are yours to set.

### Verifying the move

```bash
BASE=https://biocode.fit

curl -s $BASE/api/health | jq .commit                     # the deploy that answered
curl -s $BASE/robots.txt | grep Sitemap                   # absolute, no doubled slash
curl -s $BASE/sitemap.xml | grep -c "biocode.fit"         # every URL on the new host
curl -sI https://shtrejt.com/en/shop | grep -i location   # 308 → biocode.fit/en/shop
pnpm email:test you@example.com                           # one `sent` row in email_log
```

Then sign out, request a password reset, and click the link. That single flow exercises steps 3, 4
and 5 together, and it is the one nobody tests until a customer reports it.
