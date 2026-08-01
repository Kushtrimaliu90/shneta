-- =============================================================================
-- 18 · The subscription renewal engine's atomic steps (docs/07 §8.2–8.3)
-- =============================================================================

/*
 * Every state change a subscription can undergo happens in **one statement**, here, rather than
 * as a read followed by a write in TypeScript.
 *
 * That is not tidiness. `next_run_at += frequency` computed in the application is a
 * read-modify-write: two cron invocations that overlap — a retry, a manual trigger, Vercel
 * firing twice — both read the same date, both add one cycle, and the customer is charged for
 * one delivery and scheduled for another. Doing the arithmetic inside `update … where` makes the
 * row lock do the work.
 */

/**
 * docs/07 §8.3 — skip one delivery. The cadence is unchanged; one delivery is simply not sent.
 *
 * Returns false when the subscription is not the caller's, does not exist, or is cancelled —
 * all indistinguishable from outside, and deliberately so.
 */
create or replace function public.skip_subscription_cycle(p_subscription_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_updated int;
begin
  update subscriptions s
     set next_run_at = s.next_run_at + (s.frequency_days || ' days')::interval
   where s.id = p_subscription_id
     and s.status <> 'cancelled'
     -- `security definer` bypasses RLS, so ownership is re-checked here by hand. Service-role
     -- callers (the one-click token path, the cron) have no `auth.uid()` and are allowed through.
     and (auth.uid() is null or s.user_id = auth.uid());

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end $$;

/**
 * docs/07 §8.3 — resume a paused subscription.
 *
 * The interesting part is the date. A subscription paused for two months has a `next_run_at`
 * two months in the past, and simply flipping the status to `active` would make the engine treat
 * it as due immediately — shipping the moment somebody unpauses, which is nobody's idea of
 * "resume". The date rolls forward by whole cycles until it is in the future, so the cadence the
 * customer chose survives the pause.
 */
create or replace function public.resume_subscription(p_subscription_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_sub subscriptions;
  v_next timestamptz;
begin
  select * into v_sub
    from subscriptions
   where id = p_subscription_id
     and status <> 'cancelled'
     and (auth.uid() is null or user_id = auth.uid())
   for update;

  if v_sub.id is null then return false; end if;

  v_next := v_sub.next_run_at;
  -- Bounded: a subscription paused for a decade at a 30-day cadence needs ~122 iterations, and
  -- an unbounded loop over a corrupt date would hang the request.
  for _ in 1..500 loop
    exit when v_next > now();
    v_next := v_next + (v_sub.frequency_days || ' days')::interval;
  end loop;

  update subscriptions
     set status = 'active', paused_until = null, next_run_at = greatest(v_next, now())
   where id = p_subscription_id;

  return true;
end $$;

/**
 * docs/07 §8.2 — claim one due subscription for this run, atomically.
 *
 * **This is what makes the cron idempotent**, and it is the single most important function in
 * the milestone. The claim and the schedule advance are one statement guarded by
 * `next_run_at <= now()`, so a second invocation — a retry, an overlapping run, somebody
 * curling the endpoint twice — finds the date already moved and gets nothing back. One order
 * per cycle, without a lock table or a distributed mutex.
 *
 * It also auto-resumes a pause whose `paused_until` has passed, which docs/07 §8.3 promises the
 * cron does.
 *
 * Returns the payload the caller needs to build the order, or null when there was nothing to
 * claim. The caller cannot claim without also advancing, which is the property that matters:
 * a failure after this point means one missed delivery, not a duplicate one.
 */
create or replace function public.claim_due_subscription(p_subscription_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sub subscriptions;
  v_items jsonb;
begin
  update subscriptions s
     set next_run_at = s.next_run_at + (s.frequency_days || ' days')::interval,
         status = case
           when s.status = 'paused' and s.paused_until is not null and s.paused_until <= now()
             then 'active'::subscription_status
           else s.status end,
         paused_until = case
           when s.status = 'paused' and s.paused_until is not null and s.paused_until <= now()
             then null
           else s.paused_until end
   where s.id = p_subscription_id
     and s.next_run_at <= now()
     and (
       s.status = 'active'
       or (s.status = 'paused' and s.paused_until is not null and s.paused_until <= now())
     )
  returning * into v_sub;

  if v_sub.id is null then return null; end if;

  /*
   * Only lines that can actually be bought. docs/07 §8.2: an out-of-stock or withdrawn item is
   * skipped and noted, and an empty result skips the cycle entirely — the claim has already
   * advanced the date, so a skipped cycle is a missed delivery rather than a stuck subscription.
   *
   * Stock is deliberately *not* filtered here: `checkout_create_order` owns that decision, and
   * duplicating it would give two answers to "can this be sold".
   */
  select coalesce(jsonb_agg(jsonb_build_object('variant_id', si.variant_id, 'quantity', si.quantity)), '[]'::jsonb)
    into v_items
    from subscription_items si
    join product_variants pv on pv.id = si.variant_id
    join products p on p.id = pv.product_id
   where si.subscription_id = v_sub.id
     and pv.is_active
     and p.status = 'published'
     and p.deleted_at is null;

  return jsonb_build_object(
    'id', v_sub.id,
    'user_id', v_sub.user_id,
    'discount_pct', v_sub.discount_pct,
    'shipping_address', v_sub.shipping_address,
    'shipping_method_id', v_sub.shipping_method_id,
    'payment_provider', v_sub.payment_provider,
    'items', v_items
  );
end $$;

/**
 * docs/07 §8.2 — record a failed run; pause after three in a row.
 *
 * Pausing rather than cancelling: three failures usually means three months of an item being out
 * of stock, and cancelling somebody's subscription on the shop's behalf is not a decision a cron
 * job should make. A paused subscription is one the customer can resume in one click.
 */
create or replace function public.record_subscription_failure(p_subscription_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update subscriptions
     set consecutive_failures = consecutive_failures + 1,
         status = case when consecutive_failures + 1 >= 3 then 'paused'::subscription_status
                       else status end
   where id = p_subscription_id
  returning consecutive_failures into v_count;

  return coalesce(v_count, 0);
end $$;

/** A run that succeeded clears the counter, so three *consecutive* failures means consecutive. */
create or replace function public.record_subscription_success(p_subscription_id uuid)
returns void
language sql security definer set search_path = public as $$
  update subscriptions set consecutive_failures = 0 where id = p_subscription_id;
$$;

revoke all on function public.skip_subscription_cycle(uuid) from public;
revoke all on function public.resume_subscription(uuid) from public;
revoke all on function public.claim_due_subscription(uuid) from public;
revoke all on function public.record_subscription_failure(uuid) from public;
revoke all on function public.record_subscription_success(uuid) from public;

grant execute on function public.skip_subscription_cycle(uuid) to authenticated, service_role;
grant execute on function public.resume_subscription(uuid) to authenticated, service_role;
-- The engine's three are service-role only: no customer ever claims their own run.
grant execute on function public.claim_due_subscription(uuid) to service_role;
grant execute on function public.record_subscription_failure(uuid) to service_role;
grant execute on function public.record_subscription_success(uuid) to service_role;
