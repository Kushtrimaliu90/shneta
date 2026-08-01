-- =============================================================================
-- 17 · Subscriptions: cart intent, one-click tokens, and the renewal helpers
-- Source: docs/07 §8.
-- =============================================================================

/*
 * ---------------------------------------------------------------------------------------
 * 1 · Subscribe intent on a cart line (docs/07 §8.1)
 * ---------------------------------------------------------------------------------------
 *
 * The PDP's SubscribeToggle has to record "buy this, and again every N days" somewhere between
 * add-to-cart and checkout. docs/07 §8.1 calls for "cart metadata, v1: simplest".
 *
 * A column on `cart_items`, not a cookie. The cart already survives a device change for a
 * signed-in customer and an expiry sweep for a guest; intent stored beside the line inherits
 * all of that, and a cookie would silently disagree with the cart the moment either changed.
 *
 * Nullable: null means a one-off purchase, which is almost every line.
 */
alter table cart_items
  add column if not exists subscribe_frequency_days int
    check (subscribe_frequency_days is null or subscribe_frequency_days in (30, 45, 60, 90));

comment on column cart_items.subscribe_frequency_days is
  'docs/07 §8.1 — non-null marks this line as a subscription intent at the given cadence.';

/*
 * ---------------------------------------------------------------------------------------
 * 2 · One-click action tokens (docs/07 §8.2)
 * ---------------------------------------------------------------------------------------
 *
 * The T−3 notice email offers "skip this delivery" and "pause" as links. They must work from an
 * inbox, which means **without a session** — the whole point is that the customer does not have
 * to sign in to stop a delivery they do not want.
 *
 * A durable per-subscription token is the wrong shape here: a forwarded email would let anyone
 * skip that subscription forever. These are minted per notice, carry the action they permit, and
 * expire. Spending one marks it used, so a mail client that prefetches links cannot silently
 * skip a delivery twice.
 *
 * `action` is checked rather than free text: a token minted for `skip` cannot be replayed
 * against `pause`, even by editing the URL.
 */
create table if not exists subscription_action_tokens (
  token text primary key default generate_access_token(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  action text not null check (action in ('skip', 'pause')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists subscription_action_tokens_sub_idx
  on subscription_action_tokens (subscription_id, created_at desc);

alter table subscription_action_tokens enable row level security;

/*
 * No policy at all — default deny, deliberately.
 *
 * A token is a credential. Nobody reads this table through PostgREST: the cron mints rows with
 * the service client and `subscription_apply_token` (below) spends them inside a
 * security-definer function, which is the only path that ever needs to see one.
 */

/**
 * Spends a one-click token and applies its action. Returns what happened, for the page to say.
 *
 * `security definer` because the caller has no session — that is the feature. The token is the
 * authorisation, so everything that makes it safe is here: single use, time-limited, bound to
 * one subscription and one verb.
 */
create or replace function public.subscription_apply_token(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row subscription_action_tokens;
  v_sub subscriptions;
begin
  select * into v_row
    from subscription_action_tokens
   where token = p_token
   for update;

  if v_row.token is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  if v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into v_sub from subscriptions where id = v_row.subscription_id for update;
  if v_sub.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_sub.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'cancelled');
  end if;

  if v_row.action = 'skip' then
    -- docs/07 §8.3 — skipping moves the next run on by one cycle. Not "cancel this one": the
    -- subscription keeps its cadence, the customer simply gets one fewer delivery.
    update subscriptions
       set next_run_at = next_run_at + (frequency_days || ' days')::interval
     where id = v_sub.id;
  else
    update subscriptions set status = 'paused' where id = v_sub.id;
  end if;

  update subscription_action_tokens set used_at = now() where token = p_token;

  return jsonb_build_object('ok', true, 'action', v_row.action);
end $$;

revoke all on function public.subscription_apply_token(text) from public;
grant execute on function public.subscription_apply_token(text) to anon, authenticated, service_role;

/*
 * ---------------------------------------------------------------------------------------
 * 3 · The renewal engine's read (docs/07 §8.2)
 * ---------------------------------------------------------------------------------------
 *
 * Which subscriptions are due, and which need a T−3 notice. A view rather than a query in the
 * cron route, so "due" has one definition — the route, the admin list and any future report all
 * agree, and a paused subscription cannot be woken up by a caller that forgot a predicate.
 *
 * `paused_until` in the past auto-resumes: docs/07 §8.3 promises the cron does that, and this is
 * where "a pause that has expired is not a pause" is written down.
 */
create or replace view v_subscription_schedule
with (security_invoker = on) as
  select
    s.id,
    s.user_id,
    s.status,
    s.next_run_at,
    s.frequency_days,
    s.paused_until,
    s.consecutive_failures,
    (s.status = 'active'
      or (s.status = 'paused' and s.paused_until is not null and s.paused_until <= now()))
      as is_runnable,
    s.next_run_at <= now() as is_due,
    s.next_run_at <= now() + interval '3 days' and s.next_run_at > now() as needs_notice
  from subscriptions s
  where s.status <> 'cancelled';

comment on view v_subscription_schedule is
  'docs/07 §8.2 — one definition of due, runnable and notice-worthy, shared by the cron and the admin list.';
