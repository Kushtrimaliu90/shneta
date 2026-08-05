-- =============================================================================
-- M13 · two fixes the tests found
--
-- 1. `post_referral_earnings` skipped a referrer whose earnings net to zero.
-- 2. `mask_person_name` returned the generic label for a name with a leading space.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ── 1 · The true-up skipped exactly the case it exists for ──
--
-- The loop was `group by referrer_id having coalesce(sum(e.points), 0) <> 0`. That reads as "skip
-- referrers with nothing to pay", and it is wrong: the condition for needing a true-up is
-- `earned <> already_posted`, not `earned <> 0`.
--
-- The case it broke, which is the one the true-up was built for:
--
--     earn 50 → posted, wallet holds 50
--     the referrer spends 40, wallet holds 10
--     the order is refunded → earnings net to 0
--
-- Owed is `0 − 50 = −50`, floored to the balance, so 10 should come back. Instead the `having` excluded
-- the referrer — their earnings summed to zero — and the wallet kept 10 points for an order that was
-- returned. Silent, and permanent: no later run would revisit them either, because their earnings would
-- stay at zero.
--
-- Removed rather than corrected in place: the per-referrer `v_owed = 0 → continue` below already skips
-- everybody with nothing to do, so the `having` was only ever a premature optimisation that happened to
-- encode a false condition. Restated in full per docs/13 §X3.
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

  /*
   * Every referrer who has ever earned anything, with no `having`. The work is skipped per referrer
   * below, where the comparison is against what they have already been paid rather than against zero.
   */
  for v_referrer in
    select l.referrer_id,
           coalesce(sum(e.points), 0) as earned
      from referral_links l
      join referral_earnings e on e.link_id = l.id
     group by l.referrer_id
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
-- ── 2 · A leading space turned a customer into "një klient" ──
--
-- `split_part('  Arta Berisha', ' ', 1)` is the empty string, because the first field of a string
-- starting with the delimiter is empty. `nullif(trim(''), '')` is then null, the whole concatenation
-- collapses to null, and `coalesce` returns the generic label — so a customer who typed a leading space
-- into their name appeared to every referrer as "një klient".
--
-- Fixed by normalising whitespace before splitting: trim the ends, then collapse internal runs. That also
-- handles "Arta   Berisha", which had the same failure one field along.
-- -----------------------------------------------------------------------------
create or replace function public.mask_person_name(p_full_name text)
returns text
language sql
immutable
set search_path = public
as $$
  with tidy as (
    select nullif(regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g'), '') as name
  )
  select coalesce(
    (
      select split_part(name, ' ', 1)
        || case
             when nullif(split_part(name, ' ', 2), '') is not null
               then ' ' || upper(substr(split_part(name, ' ', 2), 1, 1)) || '.'
             else ''
           end
        from tidy
       where name is not null
    ),
    'një klient'
  );
$$;

comment on function public.mask_person_name is
  'A first name and a surname initial, or a generic label. The only form of a name one customer sees of
   another. docs/17 §6.';

grant execute on function public.mask_person_name(text) to authenticated, service_role;
