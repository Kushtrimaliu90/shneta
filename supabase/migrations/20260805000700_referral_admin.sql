-- =============================================================================
-- M13 step 6 · The admin surface (docs/17 §5)
--
-- Five mutations and one view. Every mutation is `security definer`, re-checks the caller's role for
-- itself, and writes an audit row — the role check is not delegated to the server action, because an
-- action is one caller and RLS plus these checks are the boundary (CLAUDE.md §5).
--
-- The split follows docs/17 §5: `support` may work the queue and stop a link, because "are these two
-- the same person?" is the judgement they make all day. Everything that mints money — a link created by
-- hand, a clock extended, a rate changed — is admin only.
-- =============================================================================

/*
 * "Extendable once, by an admin, with an audited note" (docs/17 §1) needs somewhere to record that it
 * has happened. A count rather than a boolean, so a second attempt is refused by comparing a number
 * instead of by trusting that nobody cleared a flag.
 */
alter table referral_links add column if not exists extended_count int not null default 0;

comment on column referral_links.extended_count is
  'How many times the twelve months have been extended by hand. Capped at one. docs/17 §1.';

-- -----------------------------------------------------------------------------
-- Approve or reject a pending link.
--
-- Approval is where the clock starts: `linked_at` is the approval time, not the signup time, so time
-- spent in this queue is BioCode's delay to own rather than the referrer's to lose.
-- -----------------------------------------------------------------------------
create or replace function public.admin_decide_referral(
  p_link_id uuid,
  p_approve boolean,
  p_note text default null,
  p_ip text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_link referral_links%rowtype;
  v_months int;
  v_linked timestamptz := now();
begin
  if not (is_service_role() or has_any_role('{admin,support}')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_link from referral_links where id = p_link_id for update;
  if not found then
    raise exception 'LINK_NOT_FOUND';
  end if;

  /*
   * Only a pending link is decidable. Re-approving a revoked one would restart a clock that has
   * already run, and "reject" on an approved link would leave earnings attached to a rejected link —
   * revocation is the operation for that, and it keeps the money.
   */
  if v_link.status <> 'pending' then
    raise exception 'LINK_ALREADY_DECIDED:%', v_link.status;
  end if;

  select coalesce((value->>'duration_months')::int, 12) into v_months
    from settings where key = 'referral';

  update referral_links
     set status = case when p_approve then 'approved' else 'rejected' end::referral_link_status,
         linked_at = case when p_approve then v_linked else null end,
         expires_at = case
                        when p_approve then v_linked + make_interval(months => coalesce(v_months, 12))
                        else null
                      end,
         approved_by = auth.uid(),
         revoke_reason = case when p_approve then null else p_note end
   where id = p_link_id;

  perform log_audit(
    case when p_approve then 'referral.approve' else 'referral.reject' end,
    'referral_link',
    p_link_id::text,
    to_jsonb(v_link),
    jsonb_build_object('note', p_note),
    p_ip
  );

  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end);
end $$;

revoke all on function public.admin_decide_referral(uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_decide_referral(uuid, boolean, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Stop a link.
--
-- Future accrual stops immediately; points already paid stay (docs/17 §1). Taking them back is a
-- separate, deliberate `adjustment` — one operation that both stops and confiscates is one that gets
-- used for the first thing and quietly does the second.
-- -----------------------------------------------------------------------------
create or replace function public.admin_revoke_referral(
  p_link_id uuid,
  p_reason text,
  p_ip text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_link referral_links%rowtype;
begin
  if not (is_service_role() or has_any_role('{admin,support}')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    -- A revocation with no reason is unanswerable three months later when the referrer asks why.
    raise exception 'REASON_REQUIRED';
  end if;

  select * into v_link from referral_links where id = p_link_id for update;
  if not found then raise exception 'LINK_NOT_FOUND'; end if;
  if v_link.status = 'revoked' then
    return jsonb_build_object('status', 'revoked', 'changed', false);
  end if;

  update referral_links
     set status = 'revoked',
         revoked_at = now(),
         revoked_by = auth.uid(),
         revoke_reason = p_reason
   where id = p_link_id;

  perform log_audit('referral.revoke', 'referral_link', p_link_id::text,
                    to_jsonb(v_link), jsonb_build_object('reason', p_reason), p_ip);

  return jsonb_build_object('status', 'revoked', 'changed', true);
end $$;

revoke all on function public.admin_revoke_referral(uuid, text, text) from public, anon;
grant execute on function public.admin_revoke_referral(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Stop every link belonging to one referrer.
--
-- The fraud panel's blunt instrument, and the reason it exists as one call: a farm is twenty links,
-- and revoking them one at a time means the twentieth is still earning while the operator works.
-- Admin only — this is the button that turns off somebody's income.
-- -----------------------------------------------------------------------------
create or replace function public.admin_revoke_referrals_for(
  p_referrer_id uuid,
  p_reason text,
  p_ip text default null
) returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_count int;
begin
  if not (is_service_role() or has_any_role('{admin}')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED';
  end if;

  with stopped as (
    update referral_links
       set status = 'revoked',
           revoked_at = now(),
           revoked_by = auth.uid(),
           revoke_reason = p_reason
     where referrer_id = p_referrer_id
       and status in ('pending', 'approved')
    returning id
  )
  select count(*) into v_count from stopped;

  perform log_audit('referral.revoke_all', 'profile', p_referrer_id::text, null,
                    jsonb_build_object('reason', p_reason, 'links', v_count), p_ip);

  return v_count;
end $$;

revoke all on function public.admin_revoke_referrals_for(uuid, text, text) from public, anon;
grant execute on function public.admin_revoke_referrals_for(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Extend the twelve months. Once, by an admin, with a note.
-- -----------------------------------------------------------------------------
create or replace function public.admin_extend_referral(
  p_link_id uuid,
  p_months int,
  p_note text,
  p_ip text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_link referral_links%rowtype;
begin
  if not (is_service_role() or has_any_role('{admin}')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'NOTE_REQUIRED';
  end if;
  if p_months is null or p_months < 1 or p_months > 12 then
    raise exception 'MONTHS_OUT_OF_RANGE';
  end if;

  select * into v_link from referral_links where id = p_link_id for update;
  if not found then raise exception 'LINK_NOT_FOUND'; end if;
  if v_link.status <> 'approved' then
    raise exception 'LINK_NOT_ACTIVE:%', v_link.status;
  end if;
  if v_link.extended_count >= 1 then
    -- "Not extendable, except once" (docs/17 §1). The second request is a conversation, not a click.
    raise exception 'ALREADY_EXTENDED';
  end if;

  update referral_links
     set expires_at = expires_at + make_interval(months => p_months),
         extended_count = extended_count + 1
   where id = p_link_id;

  perform log_audit('referral.extend', 'referral_link', p_link_id::text,
                    to_jsonb(v_link), jsonb_build_object('months', p_months, 'note', p_note), p_ip);

  return jsonb_build_object('status', 'extended', 'months', p_months);
end $$;

revoke all on function public.admin_extend_referral(uuid, int, text, text) from public, anon;
grant execute on function public.admin_extend_referral(uuid, int, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Create a link by hand.
--
-- For the case the software cannot see: somebody bought in the shop on a friend's recommendation and
-- never typed the code. Identified by the referrer's code and the referee's email, because those are
-- what an operator has in front of them — not two uuids.
--
-- It reuses `link_referral`, so a manual link obeys every rule an automatic one does: no self-referral,
-- no cycle, no second referrer, no shared phone. An admin override that skipped those checks would be
-- the hole every other check is guarding.
-- -----------------------------------------------------------------------------
create or replace function public.admin_create_referral_link(
  p_code text,
  p_referee_email text,
  p_note text,
  p_backdate_days int default 0,
  p_ip text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_referee uuid;
  v_outcome text;
  v_link referral_links%rowtype;
  v_months int;
  v_linked timestamptz;
begin
  if not (is_service_role() or has_any_role('{admin}')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'NOTE_REQUIRED';
  end if;
  if p_backdate_days is null or p_backdate_days < 0 or p_backdate_days > 365 then
    raise exception 'BACKDATE_OUT_OF_RANGE';
  end if;

  select id into v_referee
    from profiles
   where email = p_referee_email::extensions.citext
     and deleted_at is null;
  if v_referee is null then
    raise exception 'REFEREE_NOT_FOUND';
  end if;

  v_outcome := public.link_referral(v_referee, p_code, 'admin');
  if v_outcome <> 'ok' then
    -- Surfaced in full, unlike the customer path: an operator needs the actual reason to act on it.
    raise exception 'LINK_REFUSED:%', v_outcome;
  end if;

  /*
   * Created `pending` by `link_referral`, then approved here — because an admin creating a link by hand
   * has already made the decision that the queue exists to collect.
   */
  select coalesce((value->>'duration_months')::int, 12) into v_months
    from settings where key = 'referral';

  v_linked := now() - make_interval(days => p_backdate_days);

  update referral_links
     set status = 'approved',
         linked_at = v_linked,
         expires_at = v_linked + make_interval(months => coalesce(v_months, 12)),
         approved_by = auth.uid()
   where referee_id = v_referee
  returning * into v_link;

  perform log_audit('referral.manual_link', 'referral_link', v_link.id::text, null,
                    jsonb_build_object('note', p_note, 'backdate_days', p_backdate_days,
                                       'code', p_code, 'referee', p_referee_email), p_ip);

  return jsonb_build_object('status', 'approved', 'link_id', v_link.id);
end $$;

revoke all on function public.admin_create_referral_link(text, text, text, int, text) from public, anon;
grant execute on function public.admin_create_referral_link(text, text, text, int, text) to authenticated;

-- -----------------------------------------------------------------------------
-- The fraud panel's data (docs/17 §5).
--
-- Signals, not verdicts. Every one of these has an innocent explanation — a family shares an address, a
-- couple shares a phone, a popular person really does invite six friends in a week — so the view
-- reports and a human decides. Nothing here revokes anything.
--
-- `security_invoker` so the staff-only policies on `referral_links` and `profiles` still apply: a view
-- that ran as its owner would be a way to read both tables without a policy.
--
-- IP clustering from docs/17 §5 is **not** here, deliberately: no signup IP is stored anywhere, and
-- inventing a column to hold one is a privacy decision that belongs to the owner rather than to this
-- migration. What is here works from data the shop already has for other reasons.
-- -----------------------------------------------------------------------------
create or replace view referral_fraud_signals
with (security_invoker = true) as
with per_referrer as (
  select
    l.referrer_id,
    count(*) as links_total,
    count(*) filter (where l.status = 'approved') as links_approved,
    count(*) filter (where l.created_at > now() - interval '7 days') as links_last_7d,
    count(*) filter (where 'same_address' = any(l.risk_flags)) as flag_same_address,
    count(*) filter (where 'rapid_signup' = any(l.risk_flags)) as flag_rapid_signup,
    count(*) filter (where 'cap_reached' = any(l.risk_flags)) as flag_cap_reached,
    coalesce(sum(e.points), 0) as points_total
  from referral_links l
  left join referral_earnings e on e.link_id = l.id
  group by l.referrer_id
)
select
  r.referrer_id,
  p.email::text as referrer_email,
  p.full_name as referrer_name,
  p.referral_code::text as referrer_code,
  r.links_total,
  r.links_approved,
  r.links_last_7d,
  r.flag_same_address,
  r.flag_rapid_signup,
  r.flag_cap_reached,
  r.points_total,
  /*
   * How many of this referrer's referees have never ordered.
   *
   * The cheapest tell there is. A real advocate brings people who buy something; a farm brings
   * accounts. High counts here alongside a high `links_total` is the pattern worth a look.
   */
  (
    select count(*)
      from referral_links l2
     where l2.referrer_id = r.referrer_id
       and not exists (select 1 from orders o where o.user_id = l2.referee_id)
  ) as referees_without_orders
from per_referrer r
join profiles p on p.id = r.referrer_id
where r.links_total > 1
   or r.flag_same_address > 0
   or r.flag_rapid_signup > 0
   or r.flag_cap_reached > 0;

comment on view referral_fraud_signals is
  'Per-referrer signals for the fraud panel. Signals, not verdicts. docs/17 §5.';
