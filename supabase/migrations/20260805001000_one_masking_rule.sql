-- =============================================================================
-- M13 · one masking rule, not three copies
--
-- Migration 61 extracted `mask_person_name` and its comment claimed three places build the "Arta B."
-- label: `my_referral_overview`, `my_referral_source`, and the emails. Only the emails were wired to it,
-- so the comment described an intention rather than the code — and the two RPCs still carried their own
-- `split_part`/`nullif` chains.
--
-- Both restated here in full to use the helper, per docs/13 §X3: a `create or replace` is the whole
-- definition, so the whole definition belongs in the file a reader is looking at.
--
-- `grep my_referral_overview supabase/migrations/` → 20260805000200 only. This is that text, with the
-- masking expression replaced by a call and nothing else changed.
--
-- Why it matters beyond tidiness: the masking rule is the single promise that one customer never learns
-- another's surname (docs/17 §6). Three implementations is three chances for one of them to be generous,
-- and the generous one would be the one nobody re-read.
-- =============================================================================

create or replace function public.my_referral_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_stats jsonb;
  v_referrals jsonb;
  v_month_start timestamptz;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select referral_code::text into v_code from profiles where id = v_user;

  -- Calendar month, in UTC, matching how the monthly posting cron aggregates.
  v_month_start := date_trunc('month', now());

  /*
   * Aggregates over this referrer's own links.
   *
   * `points_all_time` and `points_this_month` sum `referral_earnings.points` — including negative
   * clawback rows, so a refunded order reduces the figure the referrer sees rather than leaving it
   * overstated. `count(*) filter` rather than several scans.
   */
  select jsonb_build_object(
           'approved', count(*) filter (where l.status = 'approved'),
           'pending', count(*) filter (where l.status = 'pending'),
           'expiring_30d', count(*) filter (
             where l.status = 'approved'
               and l.expires_at is not null
               and l.expires_at <= now() + interval '30 days'
           ),
           'expired', count(*) filter (where l.status = 'expired'),
           'points_all_time', coalesce((
             select sum(e.points) from referral_earnings e
              join referral_links rl on rl.id = e.link_id
             where rl.referrer_id = v_user
           ), 0),
           'points_this_month', coalesce((
             select sum(e.points) from referral_earnings e
              join referral_links rl on rl.id = e.link_id
             where rl.referrer_id = v_user
               and e.created_at >= v_month_start
           ), 0)
         )
    into v_stats
    from referral_links l
   where l.referrer_id = v_user;

  /*
   * One row per referral, masked.
   *
   * CHANGED: `public.mask_person_name(p.full_name)` where a `split_part`/`nullif` chain used to be. Same
   * output — "Arta B.", or a generic label for a single or empty name — from the one function that now
   * defines what masking means.
   *
   * `rejected` links are excluded: a referrer does not need to know that somebody it invited was
   * refused, and telling it invites a conversation between them about why.
   */
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.sort_key desc), '[]'::jsonb)
    into v_referrals
    from (
      select
        public.mask_person_name(p.full_name) as masked_name,
        to_char(coalesce(l.linked_at, l.created_at), 'YYYY-MM') as joined_month,
        l.status::text as status,
        case
          when l.status = 'approved' and l.expires_at is not null
            then greatest(0, (l.expires_at::date - now()::date))
          else null
        end as days_left,
        coalesce(l.linked_at, l.created_at) as sort_key
      from referral_links l
      join profiles p on p.id = l.referee_id
     where l.referrer_id = v_user
       and l.status <> 'rejected'
    ) r;

  /*
   * `sort_key` is used for ordering and then stripped — it is a timestamp, and a timestamp per
   * referral is a signup date, which is exactly what `joined_month` exists to avoid returning.
   */
  return jsonb_build_object(
    'code', v_code,
    'stats', v_stats,
    'referrals', (
      select coalesce(jsonb_agg(entry - 'sort_key' order by entry->>'sort_key' desc), '[]'::jsonb)
        from jsonb_array_elements(v_referrals) as entry
    )
  );
end $$;

comment on function public.my_referral_overview is
  'The referrer''s only read path: aggregates plus masked labels, no per-referee amounts. docs/17 §6.';

revoke all on function public.my_referral_overview() from public, anon;
grant execute on function public.my_referral_overview() to authenticated;

/*
 * ── The referee's own line ──
 *
 * Separate from the overview because it answers a different question — "who invited me, and where are
 * the terms?" — and because a referee is not a referrer and should not receive a referrer's payload.
 *
 * CHANGED, as above: one masking function instead of a second copy of the expression.
 */
create or replace function public.my_referral_source()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'referrer_name', public.mask_person_name(p.full_name),
        'code_used', l.code_used::text,
        'status', l.status::text,
        'joined_month', to_char(coalesce(l.linked_at, l.created_at), 'YYYY-MM')
      )
      from referral_links l
      join profiles p on p.id = l.referrer_id
     where l.referee_id = auth.uid()
       and l.status <> 'rejected'
     limit 1
    ),
    'null'::jsonb
  );
$$;

comment on function public.my_referral_source is
  'Who referred the caller, masked, or null. docs/17 §4.';

revoke all on function public.my_referral_source() from public, anon;
grant execute on function public.my_referral_source() to authenticated;
