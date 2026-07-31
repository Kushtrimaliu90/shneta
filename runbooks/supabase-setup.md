# Runbook · Applying the schema to a hosted Supabase project

Target project: **`rszbpdgfvyofvmuishmn`** — `https://rszbpdgfvyofvmuishmn.supabase.co`

**Status: applied.** All 12 migrations and the seed are live on this project, and the
integration suite passes 44/44 against it. What follows is the procedure — for re-running,
for standing up staging and production, and for recovery.

> **Before pushing to any project that holds data.** `supabase db push` applies each
> migration file in its own transaction: a file that fails rolls itself back, but files
> applied _before_ it stay applied, leaving the schema half-built. Recoverable on an empty
> project (`supabase db reset --linked` drops and replays) and **not** recoverable on one
> holding data you care about. Step 2 checks emptiness first.

### What the first run taught us

`has_any_role()` was originally defined in migration 01 but queries `profiles`, which
migration 02 creates. Postgres validates a **`language sql`** function body at `CREATE`
time — unlike plpgsql, which defers to first call — so the push aborted on file 1 with
`relation "profiles" does not exist`. The role helpers now live in migration 02, directly
after the table.

`pnpm check:sql` gained a check for exactly this (a SQL function reading a table created in
a later migration), so it fails locally instead of halfway through a push.

---

## 1 · Credentials you need

All three come from the Supabase dashboard. None of them belong in the repository, in a
commit, or pasted into a chat window.

| What                           | Where                                                                     | Used for                  |
| ------------------------------ | ------------------------------------------------------------------------- | ------------------------- |
| Personal access token          | [Account → Access Tokens](https://supabase.com/dashboard/account/tokens)  | `supabase login` / `link` |
| Database password              | Project → Settings → Database → _Database password_ (reset it if unknown) | `supabase db push`        |
| `anon` and `service_role` keys | Project → Settings → API                                                  | the app's `.env.local`    |

The **`service_role` key bypasses RLS entirely**. It is server-only, never
`NEXT_PUBLIC_`-prefixed, and never logged (CLAUDE.md §5, docs/02 §6).

---

## 2 · Link and inspect before changing anything

```bash
pnpm exec supabase login          # paste the access token
pnpm db:link                      # prompts for the database password
```

Check what is already there. If this returns any application tables, **stop** and decide
whether to reset or to reconcile — do not push on top:

```bash
pnpm exec supabase db dump --linked --schema public --data-only --file /dev/null
pnpm exec supabase inspect db table-sizes --linked
```

A dry run shows exactly which migration files would be applied and in what order:

```bash
pnpm db:diff
```

Expected: the 12 files from `supabase/migrations/`, none of them already recorded.

---

## 3 · Apply

```bash
pnpm db:push
```

Then verify — these are the guarantees the specification makes, so check them rather than
assume them:

```bash
# docs/10 §4 — RLS on every public table. Must return zero rows.
pnpm exec supabase inspect db role-configuration --linked
```

Or, in the dashboard SQL editor:

```sql
-- Must be empty (docs/10 §4).
select * from public.tables_without_rls();

-- 12 rows.
select version, name from supabase_migrations.schema_migrations order by version;

-- Sanity: enum, RPC and view all present.
select 1 from pg_type where typname = 'order_status';
select 1 from pg_proc where proname = 'checkout_create_order';
select * from public.v_stock_ledger_drift;   -- must be empty
```

### If a migration fails partway

```bash
# Only on an empty project. Drops the public schema and replays every migration + seed.
pnpm exec supabase db reset --linked
```

Fix the offending file in `supabase/migrations/`, re-run `pnpm check:sql`, push again.

---

## 4 · Seed

`supabase/seed.sql` holds configuration and taxonomy only — settings, warehouse, shipping
methods, certifications, categories, health goals, brands, legal page skeletons. All of it
is production-appropriate, and it is idempotent (fixed UUIDs + `on conflict do update`), so
running it twice is safe.

```bash
pnpm db:seed:linked
```

The demo catalogue (docs/11 §6–§9 — 30 ingredients, 24 products, articles, order fixtures)
is **not** in `seed.sql` yet and is local/staging only. Production gets the real catalogue
(docs/11 preamble).

---

## 5 · Point the app at it

Edit `.env.local` — do not commit it:

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://rszbpdgfvyofvmuishmn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from Settings → API>
SUPABASE_SERVICE_ROLE_KEY=<service_role key — server only>
```

Regenerate the database types against the live schema and re-run the gate. The generated
file replaces the M0 placeholder, so this is also what proves the schema and the TypeScript
agree:

```bash
pnpm db:types:linked
pnpm verify
```

---

## 6 · Project configuration the CLI does not push

`supabase/config.toml` governs the **local** stack only. These must be set in the dashboard
for the hosted project (docs/10 §4):

- **Auth** → email + password only; email confirmations **on**; secure email change **on**;
  anonymous sign-ins **off**.
- **Auth → URL Configuration** → site URL and redirect URLs for local, staging and prod.
- **Auth → Email Templates** → restyle to the brand (docs/08 §6).
- **Database** → daily backups; enable **PITR on production**.
- **Storage** → the five buckets _are_ created by migration `…001200`, including their size
  and MIME limits. Verify they appear.

---

## 7 · After the first successful push

- Commit nothing new — migrations are already in the repo and are the source of truth.
  **Never edit the schema in the dashboard** (CLAUDE.md §6); a dashboard change is invisible
  to the next `db push` and will drift.
- Run the integration suite against this project only if it is disposable — it creates and
  deletes users, products and orders:
  ```bash
  pnpm test:integration      # reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  ```
  On a project you intend to keep, run it against the local stack instead.
- Add the same three keys to the Vercel project (docs/10 §3) before the first deploy.
