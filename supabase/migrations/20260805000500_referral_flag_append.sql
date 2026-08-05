-- =============================================================================
-- M13 step 3, fix · `link_referral` could not append a risk flag
--
-- `v_flags := v_flags || 'same_address'` looks like array-append and is not. With an untyped literal
-- on the right, Postgres resolves `||` to `anyarray || anyarray` and tries to parse the string as an
-- array literal, so the statement died with:
--
--     malformed array literal: "rapid_signup"
--     Array value must start with "{" or dimension information.
--
-- Which means every link that *should* have been flagged was instead not created at all. From the
-- sign-up path the exception was swallowed by the guard in `handle_new_user` — working exactly as
-- intended, and hiding the bug: the account appeared, the referral silently did not. From
-- `claim_referral_code` it surfaced as a 22P02 to the customer.
--
-- `array_append` has one meaning. Restated in full rather than patched, per docs/13 §X3: a
-- `create or replace` is the whole definition, so the whole definition has to be in the file a
-- reader is looking at.
--
-- Found by the integration test for the flags, which is the only reason it was not found in
-- production by a fraudster wondering why nothing was ever flagged.
-- =============================================================================
create or replace function public.link_referral(
  p_referee_id uuid,
  p_code text,
  p_source text
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg jsonb;
  v_code extensions.citext;
  v_referrer uuid;
  v_flags text[] := '{}';
  v_max_referrals int;
  v_existing int;
  v_cursor uuid;
  v_hops int := 0;
begin
  if p_referee_id is null then return 'invalid_code'; end if;

  v_code := public.normalize_referral_code(p_code);
  if v_code is null then return 'invalid_code'; end if;

  select value into v_cfg from settings where key = 'referral';
  if coalesce((v_cfg->>'enabled')::boolean, false) is not true then
    return 'disabled';
  end if;

  /*
   * One referrer per customer, for ever — checked before anything else so a customer who already
   * has one is told so rather than having their code silently validated first.
   *
   * `unique (referee_id)` is the real guarantee; this is the readable message. Two concurrent
   * claims still end with one row, and the loser gets the constraint below.
   */
  if exists (select 1 from referral_links where referee_id = p_referee_id) then
    return 'already_linked';
  end if;

  select id into v_referrer
    from profiles
   where referral_code = v_code
     and deleted_at is null;

  if v_referrer is null then return 'invalid_code'; end if;
  if v_referrer = p_referee_id then return 'self'; end if;

  /*
   * No cycles.
   *
   * Each customer has at most one referrer, so the graph is a forest and "is the candidate referrer
   * somewhere below the referee?" is answered by walking *up* from the candidate: if the referee
   * appears, linking would close a loop. A→B→C already pays A nothing for C (§1, single level), so
   * this is about keeping the structure sane rather than about money.
   *
   * Bounded at 50 hops. The unique constraint makes an infinite chain impossible, but a loop
   * created before this function existed would spin here for ever, and a bounded walk that
   * occasionally rejects a 51-deep chain is a better failure than a wedged connection.
   */
  v_cursor := v_referrer;
  while v_cursor is not null and v_hops < 50 loop
    if v_cursor = p_referee_id then return 'cycle'; end if;
    select referrer_id into v_cursor from referral_links where referee_id = v_cursor;
    v_hops := v_hops + 1;
  end loop;

  /*
   * Same email or same phone is the same person (§1), so it is rejected rather than flagged.
   *
   * Compared on `profiles`, where phone is already normalised to E.164 by the account form, so
   * `+38344…` and `044…` do not read as two people. An empty phone matches nothing: `nullif` keeps
   * two profiles that both left it blank from looking like a match.
   */
  if exists (
    select 1
      from profiles referee, profiles referrer
     where referee.id = p_referee_id
       and referrer.id = v_referrer
       and (
         referee.email = referrer.email
         or nullif(trim(referee.phone), '') = nullif(trim(referrer.phone), '')
       )
  ) then
    return 'contact_match';
  end if;

  -- ── Risk flags: recorded for the review queue, never a rejection (docs/17 §5) ──

  /*
   * A shared delivery address is normal for a family and is exactly what a farm looks like. Only a
   * human comparing it with everything else on the link can tell which, so it is a flag.
   */
  if exists (
    select 1
      from addresses a
      join addresses b on lower(trim(a.line1)) = lower(trim(b.line1))
                      and lower(trim(a.city)) = lower(trim(b.city))
     where a.user_id = p_referee_id
       and b.user_id = v_referrer
  ) then
    v_flags := array_append(v_flags, 'same_address');
  end if;

  -- Four accounts on one code inside an hour is not how word of mouth travels.
  if (
    select count(*) from referral_links
     where referrer_id = v_referrer
       and created_at > now() - interval '1 hour'
  ) >= 3 then
    v_flags := array_append(v_flags, 'rapid_signup');
  end if;

  /*
   * A referrer at their cap still gets the link, flagged.
   *
   * §1 says exceeding a cap flags for review rather than silently dropping. Rejecting here would
   * punish the referee — a real customer holding a real code — for a limit that is about the
   * referrer, and they would see the generic "invalid code" and conclude the shop is broken.
   */
  v_max_referrals := (v_cfg->>'max_referrals_per_customer')::int;
  if v_max_referrals is not null then
    select count(*) into v_existing
      from referral_links
     where referrer_id = v_referrer
       and status in ('pending', 'approved');
    if v_existing >= v_max_referrals then
      v_flags := array_append(v_flags, 'cap_reached');
    end if;
  end if;

  /*
   * Always `pending`, even when `auto_approve` is on: that setting approves on the referee's first
   * delivered order (§1), which has not happened yet at the moment a code is entered.
   */
  begin
    insert into referral_links (referrer_id, referee_id, status, source, code_used, risk_flags)
    values (v_referrer, p_referee_id, 'pending', p_source, v_code, v_flags);
  exception when unique_violation then
    -- Lost a race with another claim. The other one is as valid as this one.
    return 'already_linked';
  end;

  return 'ok';
end $$;

comment on function public.link_referral is
  'Validates and creates a pending referral link. Returns an outcome, never raises. docs/17 §1.';

revoke all on function public.link_referral(uuid, text, text) from public, anon, authenticated;
