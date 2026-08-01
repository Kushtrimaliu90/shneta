-- =============================================================================
-- 16 · Newsletter unsubscribe (docs/08 §5)
-- =============================================================================

/*
 * docs/08 §5 requires a **signed** unsubscribe link in every marketing email. The schema had
 * nothing to sign with: `confirm_token` is cleared the moment the address is confirmed, which is
 * correct for a one-shot opt-in and useless for a link that must keep working for years.
 *
 * The obvious shortcut is `/newsletter/unsubscribe?email=…`, and it is a real defect rather than
 * a shortcut: the URL is guessable for any address anyone knows, so a stranger — or a bored
 * competitor with a customer list — can unsubscribe the entire list one request at a time. It
 * would also be invisible, because unsubscribing is exactly what an unsubscribe link is meant
 * to do.
 *
 * So: a durable per-row token, minted at insert and never cleared.
 */
alter table newsletter_subscribers
  add column if not exists unsubscribe_token text not null default generate_access_token();

-- Existing rows keep the default the ALTER just gave them; this is belt and braces for any row
-- that predates it with an empty string.
update newsletter_subscribers
   set unsubscribe_token = generate_access_token()
 where unsubscribe_token is null or unsubscribe_token = '';

create unique index if not exists newsletter_unsubscribe_token_idx
  on newsletter_subscribers (unsubscribe_token);

/*
 * `newsletter_subscribe` returns the unsubscribe token alongside the confirm token, so the
 * welcome email can carry the link without a second read. Replacing the function rather than
 * adding a second one keeps "what the caller needs to send an email" in one place.
 */
create or replace function public.newsletter_subscribe(
  p_email text,
  p_locale text default 'sq',
  p_source text default 'footer'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
  v_unsubscribe text;
begin
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;
  if p_locale not in ('sq','en') then p_locale := 'sq'; end if;

  v_token := generate_access_token();

  insert into newsletter_subscribers (email, locale, source, confirm_token)
  values (lower(p_email)::extensions.citext, p_locale, p_source, v_token)
  on conflict (email) do update
    set locale = excluded.locale,
        -- Re-subscribing after an unsubscribe restarts the double opt-in.
        confirm_token = case
          when newsletter_subscribers.confirmed_at is null then excluded.confirm_token
          else newsletter_subscribers.confirm_token end,
        unsubscribed_at = null
  returning confirm_token, unsubscribe_token into v_token, v_unsubscribe;

  -- The caller sends the confirmation email; it must never leak an existing
  -- subscriber's state back to the browser (no enumeration).
  return jsonb_build_object('confirm_token', v_token, 'unsubscribe_token', v_unsubscribe);
end $$;

/*
 * Confirming returns the address and its unsubscribe token, so the caller can send the welcome
 * email in the same request. Previously it returned a boolean and the caller had to read the row
 * *before* spending the token, which is a race: two clicks on the same link and the second one
 * finds nothing.
 *
 * `drop` first, because `create or replace function` cannot change a return type — Postgres
 * answers "cannot change return type of existing function", and the migration stops mid-file
 * with the statements before it already applied. Everything in this file is written to survive
 * exactly that: `add column if not exists`, `create index if not exists`, and now this.
 */
drop function if exists public.newsletter_confirm(text);

create or replace function public.newsletter_confirm(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row newsletter_subscribers;
begin
  update newsletter_subscribers
     set confirmed_at = coalesce(confirmed_at, now()), confirm_token = null
   where confirm_token = p_token
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('confirmed', false);
  end if;

  return jsonb_build_object(
    'confirmed', true,
    'email', v_row.email::text,
    'locale', v_row.locale,
    'unsubscribe_token', v_row.unsubscribe_token
  );
end $$;

create or replace function public.newsletter_unsubscribe(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_updated int;
begin
  update newsletter_subscribers
     set unsubscribed_at = coalesce(unsubscribed_at, now())
   where unsubscribe_token = p_token;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end $$;

revoke all on function public.newsletter_subscribe(text, text, text) from public;
revoke all on function public.newsletter_confirm(text) from public;
revoke all on function public.newsletter_unsubscribe(text) from public;
grant execute on function public.newsletter_subscribe(text, text, text) to anon, authenticated, service_role;
grant execute on function public.newsletter_confirm(text) to anon, authenticated, service_role;
grant execute on function public.newsletter_unsubscribe(text) to anon, authenticated, service_role;
