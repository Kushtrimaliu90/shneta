-- =============================================================================
-- Social sign-in: take the name whatever shape the provider sends it in.
--
-- docs/05 §15. `handle_new_user` read exactly one key:
--
--     coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), '')
--
-- which is the key the email sign-up action writes, and — as it happens — one of the keys
-- Supabase's Google provider populates too. So Google alone would have worked without this
-- migration. It is here for the two cases that follow, both of which produce a customer whose
-- account has no name on it:
--
--   * **Providers that only send `name`.** Supabase normalises Google, but the mapping is not
--     uniform across providers, and `name` is the OIDC standard claim. Reading only the
--     Supabase-specific alias makes the trigger depend on a normalisation step rather than on
--     the token.
--   * **Providers that send the parts and not the whole.** `given_name` + `family_name` is what
--     an OIDC token carries when the issuer has no single display name. Apple in particular
--     sends a name **only on the very first authorisation** and sends it split, so the one
--     chance to capture it is the insert this trigger runs in.
--
-- Order matters and is deliberate: `full_name` first, so the email sign-up path — where the
-- customer typed their own name into a field — always wins over anything an identity provider
-- guessed. Everything is `nullif`-ed to '' so a provider sending an empty string is treated as
-- having sent nothing rather than overwriting a better answer with blank.
--
-- Still falls back to '' rather than to the email local part. A profile with an empty name is a
-- prompt to fill one in; a profile named "arta.b" is a wrong answer that looks like a right one,
-- and it would leak into `mask_person_name`, which is what one customer sees of another.
--
-- Unchanged: the referral link below it, the exception guard around it, and the
-- `on conflict (id) do nothing`. Only the name expression moves.
-- =============================================================================

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

  /* The name, from whichever key the caller or the provider actually filled in. */
  v_full_name text := coalesce(
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    nullif(
      trim(
        coalesce(new.raw_user_meta_data->>'given_name', '') || ' ' ||
        coalesce(new.raw_user_meta_data->>'family_name', '')
      ),
      ''
    ),
    ''
  );
begin
  insert into profiles (id, email, full_name, referral_code)
  values (
    new.id,
    new.email,
    v_full_name,
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
  'Creates the profile for a new auth user, resolving the display name from full_name, name, or '
  'given_name + family_name so social sign-ins are not left nameless, and links an invite code '
  'carried in user metadata. docs/05 §15, docs/17 §1.';
