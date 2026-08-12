-- 86 · One audit row per decided row of a bulk decision, in one statement
--
-- The admin panel is gaining multi-select approve/reject for merchant offers and product proposals. A
-- decision on twenty rows is twenty decisions and must leave twenty audit rows — "every decision ever
-- made about this offer" has to stay answerable as one query on `entity_id`, which a single summary row
-- keyed to an arbitrary id list could not satisfy.
--
-- ── Why this cannot be done from TypeScript ──
--
-- `audit_logs` has **no insert policy** (docs/13 §B5). That is deliberate: with RLS enabled, a direct
-- insert from any client — service role aside — is denied, so the only way in is a `security definer`
-- function. And `actor_id` must be resolved from `auth.uid()` *inside* the database, or the row records
-- who the caller said they were rather than who they are.
--
-- Without this, twenty rows means twenty `log_audit` round trips, each needing its own SSR client and its
-- own `await headers()`. One statement instead.
--
-- Mirrors `log_audit` (20260731000900_rpc_support.sql) exactly: same gate, same definer rights, same
-- search_path pin, actor taken from the session and never from an argument. The only differences are the
-- array input and the returned count.
create or replace function public.log_audit_many(
  p_action text,
  p_entity_type text,
  p_rows jsonb,
  p_ip text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role;
  v_count integer;
begin
  if not (is_service_role() or is_staff() or is_admin()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  /*
   * Shape checked before the insert rather than trusted. `jsonb_array_elements` raises on a non-array,
   * but it raises from inside the insert, and a named error is what the caller's fallback branches on.
   */
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ROWS_NOT_AN_ARRAY';
  end if;

  /*
   * 200 is a backstop, not the product rule. The feature caps a selection at 25, so this can only be
   * reached by a caller doing something else — and an unbounded audit insert is the one way this
   * function could be turned into a way to fill the table.
   */
  if jsonb_array_length(p_rows) > 200 then
    raise exception 'TOO_MANY_ROWS';
  end if;

  select role into v_role from profiles where id = auth.uid();

  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, before, after, ip)
  select auth.uid(), v_role, p_action, p_entity_type,
         e ->> 'entity_id', e -> 'before', e -> 'after', p_ip
    from jsonb_array_elements(p_rows) as e;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function public.log_audit_many(text, text, jsonb, text) is
  'docs/06 preamble — one audit row per decided row of a bulk decision, written in one statement '
  'because audit_logs has no insert policy and the actor must come from auth.uid(). docs/13 §AM.';

revoke all on function public.log_audit_many(text, text, jsonb, text) from public, anon;
grant execute on function public.log_audit_many(text, text, jsonb, text) to authenticated, service_role;
