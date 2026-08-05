-- =============================================================================
-- M13 step 8 · The four event-driven emails (docs/17 §7)
--
-- ── Why a sweep and not four call sites ──
--
-- `joined`, `approved`, `revoked` and the referee's `welcome` are each triggered by a state change that
-- can happen in four different places: the sign-up trigger inside `handle_new_user` (which is SQL and
-- cannot send mail), the account claim action, the admin queue, and the auto-approve cron. Wiring each
-- site separately means four call sites, three of which are easy to forget and one of which is
-- impossible.
--
-- So the state change leaves a mark and the daily cron sends. One implementation, idempotent by a
-- column rather than by luck, and it covers a link however it was created — including one an admin made
-- by hand at a psql prompt. The cost is up to a day's delay on "somebody used your code", which is the
-- right trade for a message nobody acts on urgently.
-- =============================================================================

alter table referral_links add column if not exists joined_email_at timestamptz;
alter table referral_links add column if not exists approved_email_at timestamptz;
alter table referral_links add column if not exists revoked_email_at timestamptz;

comment on column referral_links.joined_email_at is
  'When the referrer was told somebody used their code, and the referee was welcomed. docs/17 §7.';

/*
 * Partial indexes on the null case, which is the only case the sweep looks for.
 *
 * The sweep runs daily over a table that only grows, and "where the column is null" is a shrinking
 * fraction of it. Without these it becomes a full scan whose cost rises with every referral ever made.
 */
create index if not exists referral_links_joined_email_idx on referral_links (created_at)
  where joined_email_at is null;
create index if not exists referral_links_approved_email_idx on referral_links (linked_at)
  where approved_email_at is null;
create index if not exists referral_links_revoked_email_idx on referral_links (revoked_at)
  where revoked_email_at is null;

-- -----------------------------------------------------------------------------
-- "Arta B." — the only form of a customer's name that reaches another customer.
--
-- Extracted because three places now build it: `my_referral_overview`, `my_referral_source`, and the
-- emails. Three copies of a masking rule is three chances for one of them to be generous.
--
-- `immutable` and `strict`-safe: a null or empty name gives the generic label rather than an email local
-- part, which would be an identifier.
-- -----------------------------------------------------------------------------
create or replace function public.mask_person_name(p_full_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(trim(split_part(coalesce(p_full_name, ''), ' ', 1)), '')
      || case
           when nullif(trim(split_part(coalesce(p_full_name, ''), ' ', 2)), '') is not null
             then ' ' || upper(substr(trim(split_part(p_full_name, ' ', 2)), 1, 1)) || '.'
           else ''
         end,
    'një klient'
  );
$$;

comment on function public.mask_person_name is
  'A first name and a surname initial, or a generic label. The only form of a name one customer sees of
   another. docs/17 §6.';

grant execute on function public.mask_person_name(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Who is owed an email.
--
-- Returns both parties' contact details for `joined`, because that one event produces two messages — the
-- referrer hears that their code was used and the referee is welcomed — and sending them from one row
-- means they cannot get out of step with each other.
--
-- What it does **not** return is anything about the referee's shopping. The referrer's email is built
-- from `referrer_*` plus `referee_masked_name`, which is a first name and an initial (docs/17 §6).
-- -----------------------------------------------------------------------------
create or replace function public.referral_links_needing_email(p_kind text)
returns table (
  link_id uuid,
  referrer_email text,
  referrer_locale text,
  referrer_code text,
  referee_email text,
  referee_locale text,
  referee_masked_name text,
  referrer_masked_name text,
  revoke_reason text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not is_service_role() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_kind not in ('joined', 'approved', 'revoked') then
    raise exception 'UNKNOWN_EMAIL_KIND:%', p_kind;
  end if;

  return query
  select
    l.id,
    rr.email::text,
    rr.preferred_locale,
    rr.referral_code::text,
    re.email::text,
    re.preferred_locale,
    public.mask_person_name(re.full_name),
    public.mask_person_name(rr.full_name),
    l.revoke_reason
  from referral_links l
  join profiles rr on rr.id = l.referrer_id
  join profiles re on re.id = l.referee_id
 where rr.deleted_at is null
   and re.deleted_at is null
   and case p_kind
         when 'joined' then l.joined_email_at is null and l.status in ('pending', 'approved')
         when 'approved' then l.approved_email_at is null and l.status = 'approved'
         -- Only a revocation somebody performed. An `expired` link gets the T−7 notice instead, and
         -- telling a referrer twice that the same thing ended is how an email list gets muted.
         when 'revoked' then l.revoked_email_at is null and l.status = 'revoked'
       end
 -- Bounded, so one enormous backlog cannot time the cron out. The rest go tomorrow.
 limit 200;
end $$;

comment on function public.referral_links_needing_email is
  'Links awaiting a `joined`, `approved` or `revoked` email. Bounded at 200. docs/17 §7.';

revoke all on function public.referral_links_needing_email(text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Stamp what was sent.
--
-- Separate from the select, and called after the provider accepts, so a mail outage means the email is
-- retried tomorrow rather than marked sent and lost. The opposite order — stamp then send — turns a
-- transient Resend failure into a permanently missing email.
-- -----------------------------------------------------------------------------
create or replace function public.mark_referral_emailed(p_link_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not is_service_role() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update referral_links
     set joined_email_at = case when p_kind = 'joined' then now() else joined_email_at end,
         approved_email_at = case when p_kind = 'approved' then now() else approved_email_at end,
         revoked_email_at = case when p_kind = 'revoked' then now() else revoked_email_at end
   where id = p_link_id;
end $$;

revoke all on function public.mark_referral_emailed(uuid, text) from public, anon, authenticated;
