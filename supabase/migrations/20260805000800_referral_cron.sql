-- =============================================================================
-- M13 step 7 · What the daily cron runs (docs/17 §3)
--
-- Three functions, all service-role only. They live in SQL rather than in the route handler for the
-- reason every other engine in this project does: the guarantee has to hold for a replayed invocation,
-- and "one row per referrer per month" is a statement about the database, not about a loop.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Expire what has run out.
--
-- Cheap, and first, because an expired link must not accrue and must not be emailed a "your referral is
-- ending" notice on the day after it ended.
-- -----------------------------------------------------------------------------
create or replace function public.expire_referral_links()
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_count int;
begin
  if not is_service_role() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  with done as (
    update referral_links
       set status = 'expired'
     where status = 'approved'
       and expires_at is not null
       and expires_at <= now()
    returning id
  )
  select count(*) into v_count from done;

  return v_count;
end $$;

revoke all on function public.expire_referral_links() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Post the month's earnings, as a true-up.
--
-- ── Why this is not "sum the unposted rows" ──
--
-- A clawback posts only what the referrer's balance allowed, because `sync_loyalty_balance` clamps at
-- zero and a ledger that disagrees with the balance is worse than an under-recovered clawback
-- (migration 58). That leaves a shortfall: the earnings ledger says −100 and the wallet only moved −20.
--
-- Summing rows whose `loyalty_transaction_id` is null would pay that shortfall twice — once by not
-- recovering it, and again next month when the positive rows are totalled without it. So the amount owed
-- is computed as a **difference between two ledgers**:
--
--     owed = sum(referral_earnings.points) − sum(posted referral loyalty_transactions)
--
-- across everything that referrer has ever earned. That is self-correcting: whatever happened last
-- month, the wallet ends the run holding exactly what the earnings ledger says it should.
--
-- `loyalty_transaction_id` is still set on the rows swept, because it is what the admin panel reads to
-- show "posted / not yet" — but it is a label here rather than the arithmetic.
--
-- ── One row per referrer per month ──
--
-- docs/17 §0.2. A row per referred order would be a dated list of when that customer shopped, readable
-- by the referrer on their own points page. One aggregated row a month is not.
-- -----------------------------------------------------------------------------
create or replace function public.post_referral_earnings(p_period text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_period text := coalesce(p_period, to_char(now(), 'YYYY-MM'));
  v_note text;
  v_referrer record;
  v_owed int;
  v_tx uuid;
  v_referrers int := 0;
  v_points int := 0;
begin
  if not is_service_role() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  v_note := 'Referral earnings — ' || v_period;

  for v_referrer in
    select l.referrer_id,
           coalesce(sum(e.points), 0) as earned
      from referral_links l
      join referral_earnings e on e.link_id = l.id
     group by l.referrer_id
    having coalesce(sum(e.points), 0) <> 0
  loop
    /*
     * The true-up. `reason in ('referral','referral_clawback')` is every posting this engine has ever
     * made for this person, so the difference is what is still owed — no matter which rows were swept in
     * which month, or how much of a clawback the balance could absorb at the time.
     */
    select v_referrer.earned - coalesce(sum(t.points), 0)
      into v_owed
      from loyalty_transactions t
     where t.user_id = v_referrer.referrer_id
       and t.reason in ('referral', 'referral_clawback');

    if coalesce(v_owed, 0) = 0 then
      continue;
    end if;

    /*
     * Idempotent on the note, which carries the period.
     *
     * Running twice on the same day must not pay twice. The second run computes `v_owed = 0` — because
     * the first run's transaction is now part of the subtraction above — so this guard is belt and
     * braces rather than the mechanism. It matters for the case where a run is retried after posting
     * some referrers and failing on a later one.
     */
    if exists (
      select 1 from loyalty_transactions
       where user_id = v_referrer.referrer_id
         and reason in ('referral', 'referral_clawback')
         and note = v_note
    ) then
      continue;
    end if;

    -- A negative true-up is floored to the balance, for the reason in migration 58.
    if v_owed < 0 then
      v_owed := -least(
        -v_owed,
        coalesce((select loyalty_points from profiles where id = v_referrer.referrer_id), 0)
      );
      if v_owed = 0 then continue; end if;
    end if;

    insert into loyalty_transactions (user_id, points, reason, note)
    values (
      v_referrer.referrer_id,
      v_owed,
      case when v_owed < 0 then 'referral_clawback' else 'referral' end,
      v_note
    )
    returning id into v_tx;

    /*
     * Label every settled earning with the transaction that settled it, so the admin panel's
     * "posted / not yet" column and the liability figure both tell the truth. One transaction for many
     * earnings is the point of aggregating, so many rows share the id.
     */
    update referral_earnings e
       set loyalty_transaction_id = v_tx
     where e.loyalty_transaction_id is null
       and e.link_id in (select id from referral_links where referrer_id = v_referrer.referrer_id);

    v_referrers := v_referrers + 1;
    v_points := v_points + v_owed;
  end loop;

  return jsonb_build_object('period', v_period, 'referrers', v_referrers, 'points', v_points);
end $$;

comment on function public.post_referral_earnings is
  'Monthly true-up: one aggregated ledger row per referrer. docs/17 §0.2, §3.';

revoke all on function public.post_referral_earnings(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Auto-approve, when the setting says so.
--
-- Default off (docs/17 §1), and what it approves on is the referee's **first delivered order** — not
-- their signup. That is the whole idea: somebody who has actually received something from the shop is a
-- real customer, which is the question the review queue exists to answer.
--
-- A link carrying a risk flag is never auto-approved. The flags exist to put a link in front of a
-- person, and a switch that skipped them would quietly make the fraud panel decorative.
-- -----------------------------------------------------------------------------
create or replace function public.auto_approve_referral_links()
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg jsonb;
  v_months int;
  v_count int;
begin
  if not is_service_role() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select value into v_cfg from settings where key = 'referral';
  if coalesce((v_cfg->>'enabled')::boolean, false) is not true
     or coalesce((v_cfg->>'auto_approve')::boolean, false) is not true then
    return 0;
  end if;

  v_months := coalesce((v_cfg->>'duration_months')::int, 12);

  with eligible as (
    select l.id
      from referral_links l
     where l.status = 'pending'
       and cardinality(l.risk_flags) = 0
       and exists (
         select 1 from orders o
          where o.user_id = l.referee_id
            and o.status = 'delivered'
       )
  ), done as (
    update referral_links l
       set status = 'approved',
           linked_at = now(),
           expires_at = now() + make_interval(months => v_months)
     where l.id in (select id from eligible)
    returning l.id
  )
  select count(*) into v_count from done;

  /*
   * Audited as the service role, because an approval that moves money should be attributable even when
   * the actor is a schedule. `log_audit` reads `auth.uid()`, which is null here — the `action` name is
   * what identifies the cron.
   */
  if v_count > 0 then
    perform log_audit('referral.auto_approve', 'referral_link', null, null,
                      jsonb_build_object('count', v_count));
  end if;

  return v_count;
end $$;

comment on function public.auto_approve_referral_links is
  'Approves flag-free pending links once the referee has a delivered order. Off by default. docs/17 §1.';

revoke all on function public.auto_approve_referral_links() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Who needs an expiry warning.
--
-- A read, not a send: the cron decides what to do with the list, and keeping the query here means the
-- T−30 and T−7 windows are one definition rather than two date expressions in TypeScript.
--
-- The window is a single day wide on purpose. "Expires within 30 days" would match every day from T−30
-- to T−0 and email the same referrer thirty times.
-- -----------------------------------------------------------------------------
create or replace function public.referral_links_expiring(p_days int)
returns table (
  link_id uuid,
  referrer_id uuid,
  referrer_email text,
  referrer_name text,
  referrer_locale text,
  expires_at timestamptz,
  points_earned int
)
language sql
security definer
set search_path = public, extensions
as $$
  select
    l.id,
    p.id,
    p.email::text,
    p.full_name,
    p.preferred_locale,
    l.expires_at,
    coalesce((select sum(e.points)::int from referral_earnings e where e.link_id = l.id), 0)
  from referral_links l
  join profiles p on p.id = l.referrer_id
 where l.status = 'approved'
   and l.expires_at is not null
   and p.deleted_at is null
   -- Exactly the day that is `p_days` away, so a referrer hears once per window.
   and (l.expires_at at time zone 'UTC')::date = ((now() + make_interval(days => p_days)) at time zone 'UTC')::date;
$$;

comment on function public.referral_links_expiring is
  'Links whose twelve months end in exactly p_days days. One day wide, so nobody is emailed twice.';

revoke all on function public.referral_links_expiring(int) from public, anon, authenticated;
