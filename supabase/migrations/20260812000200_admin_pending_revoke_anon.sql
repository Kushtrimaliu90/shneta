-- 85 · `v_admin_pending` is not for the public, and saying so out loud
--
-- Migration 84 granted select on the view to `authenticated, service_role` and named `anon` nowhere.
-- `anon` could read it anyway: Supabase ships `alter default privileges in schema public grant all on
-- tables to anon, authenticated, service_role`, so every new table and view is granted to `anon` at
-- creation and naming the grantees in the migration adds nothing. Probed rather than assumed — a
-- signed-out anon-key request returned a full row.
--
-- It returned eleven zeros, so nothing leaked: RLS on the underlying tables is `security_invoker`'s
-- whole point and it held. But "safe because every one of eleven policies is right" is a worse position
-- than "unreachable", and this view exists precisely to aggregate what is happening inside the business.
-- One permissive policy added to `contact_messages` in a year's time would silently turn it into a public
-- backlog counter, and nothing in that future change would look like it touched this.
--
-- So the grant becomes the boundary as well as RLS. Revoked rather than rewritten with a definer guard,
-- because the correct answer to "may anon count our pending orders" is not a smaller number.
revoke all on public.v_admin_pending from anon;

comment on view public.v_admin_pending is
  'One row of counts: everything across the panel that is waiting for a staff decision. Read by the '
  'admin layout on every render to badge the sidebar, and by the dashboard for the "Needs attention" '
  'list. security_invoker so RLS decides what each role can count, and revoked from anon so a signed-out '
  'client cannot reach it at all. docs/06 §1, docs/13 §AK.';
