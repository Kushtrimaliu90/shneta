-- =============================================================================
-- M13 step 3 · Code entry (docs/17 §1 linking, §6 privacy)
--
-- Three entry points, one implementation:
--
--   sign-up field      → the code rides in `raw_user_meta_data`, and `handle_new_user` links it
--   `/r/{CODE}`        → a cookie pre-fills that same field
--   account, in grace  → `claim_referral_code()` while the customer has never ordered
--
-- All three end in `link_referral()`, so the validation rules cannot drift between the path a real
-- customer takes and the path a test takes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What the customer typed → the code as stored, or null.
--
-- A code is read off somebody's phone screen and typed into a field, so `bio k7f2m`, `BIOK7F2M`,
-- `k7f2m` and `Bio-K7f2m` are all the same code and all arrive. Normalising here rather than
-- trusting the input means one rule for the sign-up field, the account form and the tests.
--
-- The bare five characters are accepted because the prefix carries no information — it is branding.
-- And accepting them is unambiguous rather than merely convenient: `I` and `O` are not in the
-- alphabet, so no code body can begin with `BIO`, so an eight-character input starting with `BIO`
-- can only be a prefixed code and a five-character one can only be a body.
-- -----------------------------------------------------------------------------
create or replace function public.normalize_referral_code(p_code text)
returns extensions.citext
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_clean text;
  v_body text;
begin
  v_clean := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');

  if length(v_clean) = 8 and left(v_clean, 3) = 'BIO' then
    v_body := right(v_clean, 5);
  elsif length(v_clean) = 5 then
    v_body := v_clean;
  else
    return null;
  end if;

  -- The generator's alphabet, so a code containing a character it never emits is rejected here
  -- rather than reaching the index as a lookup that cannot match.
  if v_body !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$' then
    return null;
  end if;

  return ('BIO-' || v_body)::extensions.citext;
end $$;

comment on function public.normalize_referral_code is
  'Typed input to a stored BIO-XXXXX code, or null if it cannot be one. docs/17 §1.';

grant execute on function public.normalize_referral_code(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- The one implementation.
--
-- Returns an outcome string rather than raising, for two reasons. It is called from
-- `handle_new_user`, where an exception would abort account creation — a referral bug must never
-- stop somebody registering. And the caller, not this function, decides how much of the outcome the
-- customer is allowed to know (§6): the distinction between "no such code" and "that code is
-- yours" matters to the UI and must not reach the wire.
--
-- Not granted to anyone. `claim_referral_code` and the signup trigger are the only callers.
-- -----------------------------------------------------------------------------
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
    v_flags := v_flags || 'same_address';
  end if;

  -- Four accounts on one code inside an hour is not how word of mouth travels.
  if (
    select count(*) from referral_links
     where referrer_id = v_referrer
       and created_at > now() - interval '1 hour'
  ) >= 3 then
    v_flags := v_flags || 'rapid_signup';
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
      v_flags := v_flags || 'cap_reached';
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

-- -----------------------------------------------------------------------------
-- The customer-facing claim, for the grace window.
--
-- Grace runs until the first order (§1). After that the field disappears: a referral is a reward
-- for bringing a new customer, and somebody who has already shopped here was not brought by
-- anyone. Checked against `orders` rather than a flag, so it cannot fall out of step with reality.
-- -----------------------------------------------------------------------------
create or replace function public.claim_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_outcome text;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;

  if exists (select 1 from orders where user_id = v_user) then
    return jsonb_build_object('status', 'grace_closed');
  end if;

  v_outcome := public.link_referral(v_user, p_code, 'account');

  /*
   * §6 — one generic answer for every rejection that says something about the *code*.
   *
   * "No such code", "that code's owner shares your phone number", "its owner is at their cap" and
   * "linking you would close a loop" all collapse to `invalid`. Distinguishing them turns this
   * endpoint into an oracle: a script could walk the 33^5 code space and learn which codes exist,
   * and worse, a fraudster would learn precisely which of their signals tripped and adjust it.
   *
   * The two that survive are facts about the **caller's own account** — they already have a
   * referrer, or they typed their own code — which they can see on their own screen anyway, and
   * which are the two mistakes real people actually make.
   */
  return jsonb_build_object(
    'status',
    case v_outcome
      when 'ok' then 'ok'
      when 'already_linked' then 'already_linked'
      when 'self' then 'self'
      else 'invalid'
    end
  );
end $$;

comment on function public.claim_referral_code is
  'Links the caller to a referral code during the grace window. One generic rejection. docs/17 §1, §6.';

revoke all on function public.claim_referral_code(text) from public, anon;
grant execute on function public.claim_referral_code(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Sign-up carries the code in user metadata.
--
-- Restated in full, which is the §X3 rule: this function's real behaviour is whatever the last
-- `create or replace` says, so every migration that touches it has to contain the whole thing. What
-- migration 52 added — generating the referral code inside the insert — is preserved below; the new
-- part is the block after it.
--
-- The code travels in `raw_user_meta_data` because there is no session at sign-up when email
-- confirmation is on: `auth.signUp` returns a user and no JWT, so an RPC keyed on `auth.uid()`
-- would have nobody to link. The trigger runs as the definer at the moment the profile appears,
-- which works whether confirmation is on or off.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_code text := nullif(new.raw_user_meta_data->>'referral_code', '');
  /*
   * `link` means the code arrived via `/r/{CODE}`; `signup` means it was typed into the field. Worth
   * distinguishing because the two convert differently and the admin queue shows it.
   *
   * Sanitised against the column's own check constraint rather than passed through: metadata is
   * caller-supplied, and a value outside the allowed set would fail the insert, which the guard below
   * would swallow — a dropped referral caused by a typo three files away.
   */
  v_source text := case new.raw_user_meta_data->>'referral_source'
                     when 'link' then 'link'
                     else 'signup'
                   end;
begin
  insert into profiles (id, email, full_name, referral_code)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), ''),
    public.generate_referral_code()
  )
  on conflict (id) do nothing;

  /*
   * Exception-guarded on purpose.
   *
   * `link_referral` returns outcomes rather than raising, so this should be unreachable. It is here
   * because the cost of being wrong is asymmetric: a bug in referral linking that propagates out of
   * this trigger does not lose a referral, it stops account creation for everyone. A dropped link
   * can be added by hand from `/admin/referrals`; a sign-up form that rejects every customer cannot
   * be fixed from the admin panel.
   */
  if v_code is not null then
    begin
      perform public.link_referral(new.id, v_code, v_source);
    exception when others then
      raise warning 'referral link failed for %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end $$;

comment on function public.handle_new_user is
  'Creates the profile, issues its referral code, and links an invite code from signup metadata.';
