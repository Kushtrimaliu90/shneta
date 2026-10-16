-- =============================================================================
-- 00 · Default privileges for everything the migrations create
-- =============================================================================

/*
 * Every table, view, sequence and function this repo creates in `public` relies on Supabase's
 * default privileges to be reachable through PostgREST at all: the platform ships
 * `alter default privileges for role postgres in schema public grant all on tables to anon,
 * authenticated, service_role` (and the same for sequences and functions), so an object created by
 * `postgres` is granted to the API roles the moment it exists, and RLS — not the grant — decides
 * what each role sees (docs/02 §6). The hardening migrations that `revoke … from anon` on specific
 * objects are written against that baseline.
 *
 * Those defaults are declared **for the `postgres` role**. On the hosted project every migration
 * runs as `postgres`, so they apply. On GitHub Actions, supabase CLI 2.110 applies migrations as a
 * different role, and the defaults do not follow it: every table came up with no grants at all, and
 * the first PostgREST request from the integration suite — as `service_role`, with the stack's own
 * key — answered `42501 permission denied for table warehouses`. The suite had not run on CI since
 * it was written (docs/13 §BH).
 *
 * So this file, sorted before every other migration, declares the same defaults for **whichever role
 * is running the migrations**. `alter default privileges` without `for role` binds to the current
 * role; on the hosted project that is `postgres`, where the statement is a no-op repeat of what
 * Supabase already set, and on CI it is whatever the CLI uses, which is the point.
 *
 * Nothing here widens what the API can reach: the grants are exactly the ones production has had
 * from day one, and every later `revoke` still applies on top.
 */

grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
