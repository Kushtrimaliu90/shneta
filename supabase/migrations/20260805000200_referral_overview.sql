-- =============================================================================
-- 53 · M13 · my_referral_overview — the referrer's only read path
-- Source: docs/17 §4, §6.
-- =============================================================================

/*
 * ── Why this is a function and not a policy ──
 *
 * A referrer wants to know how its invitations are doing. The natural implementation is a policy
 * letting it select its own `referral_links` rows — and that hands it `referee_id`, which is a
 * primary key into everything a referred customer has ever done. Not because the policy is wrong, but
 * because the row contains an identifier and rows are joined.
 *
 * So there is no such policy (migration 52 says so where it would have been), and this is the whole
 * customer-facing surface: aggregates, plus one masked label per referral. `security definer`, because
 * it reads rows the caller is deliberately not allowed to read.
 *
 * ── The privacy limit this cannot fix ──
 *
 * With exactly one active referral, `points_this_month × 100` **is** that person's monthly spend. No
 * shape of response prevents that arithmetic (docs/17 §0.2). What this function can do, and does:
 *
 *   · never return a per-referee amount, order count, or date — the shape makes it impossible rather
 *     than merely absent, since there is no field to put one in;
 *   · return a **join month**, not a join date, so a signup cannot be correlated with anything;
 *   · return `days_left` rather than `expires_at`, for the same reason at the other end;
 *   · mask the name to a first name and an initial, which is enough to recognise somebody you invited
 *     and not enough to identify a stranger.
 *
 * Monthly accrual posting (§3) is the other half: it decouples "points arrived" from "an order was
 * delivered", so even the aggregate does not leak timing.
 *
 * ── Shape is the contract ──
 *
 * `tests/integration/referrals.test.ts` asserts the returned keys exactly. A future field called
 * anything like `amount` or `order_count` fails that test, which is the point: the privacy rule is
 * enforced by a test on the response, not by a reviewer remembering §0.2.
 */
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
   * `split_part(full_name, ' ', 1)` plus the first letter of the remainder gives "Arta B." — and
   * `nullif` handles the single-name and empty-name cases, where the fallback is a generic label
   * rather than an email local part, which would be an identifier.
   *
   * `rejected` links are excluded: a referrer does not need to know that somebody it invited was
   * refused, and telling it invites a conversation between them about why.
   */
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.sort_key desc), '[]'::jsonb)
    into v_referrals
    from (
      select
        coalesce(
          nullif(trim(split_part(p.full_name, ' ', 1)), '')
            || case
                 when nullif(trim(split_part(p.full_name, ' ', 2)), '') is not null
                   then ' ' || upper(substr(trim(split_part(p.full_name, ' ', 2)), 1, 1)) || '.'
                 else ''
               end,
          'Klient'
        ) as masked_name,
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
 * Returns the referrer's masked name only. A referee learning the full name of whoever's code they
 * typed is fine socially and unnecessary technically; masking both directions keeps one rule.
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
        'referrer_name', coalesce(
          nullif(trim(split_part(p.full_name, ' ', 1)), '')
            || case
                 when nullif(trim(split_part(p.full_name, ' ', 2)), '') is not null
                   then ' ' || upper(substr(trim(split_part(p.full_name, ' ', 2)), 1, 1)) || '.'
                 else ''
               end,
          'një klient'
        ),
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
