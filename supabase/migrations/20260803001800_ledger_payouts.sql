-- =============================================================================
-- 40 · M12 · The ledger fills itself, and payouts are built from it
-- Source: docs/16 §8.
-- =============================================================================

/*
 * ── When money is owed, and why not earlier ──
 *
 * A merchant is owed for a fulfilment when it has been **delivered**, not when it was shipped and not
 * when the order was paid. Two reasons, and the second is the one that costs money:
 *
 *   1. A parcel in transit can still come back. Paying on `shipped` means clawing money back through
 *      the ledger for every failed delivery, and a statement full of reversals is a statement nobody
 *      trusts.
 *   2. **COD is collected on delivery.** On a cash order BioCode has no money until the courier hands
 *      it over, so owing the merchant its share before that is lending, not settling.
 *
 * `delivered` is BioCode's word to record — the transition guard refuses it from a merchant, precisely
 * so a merchant cannot trigger its own payout (§7).
 *
 * ── The signed single column, restated ──
 *
 * `merchant_ledger.amount_cents` is signed: **positive is owed to the merchant, negative is owed by
 * it.** COD runs both ways — normally BioCode's courier collects the cash and owes the merchant its
 * net, but a merchant with its own courier collects and owes BioCode the commission — and one signed
 * column expresses both. The balance is `sum(amount_cents)`, and there is no update or delete policy
 * anywhere: a correction is another row, the same discipline as `stock_movements` (docs/13 §A7).
 */

-- -----------------------------------------------------------------------------
-- Posting a delivered fulfilment to the ledger
-- -----------------------------------------------------------------------------

/*
 * Three rows per delivered fulfilment, or two, depending on who took the cash.
 *
 *   sale           +subtotal      what the goods sold for
 *   commission     −commission    BioCode's share
 *   shipping       −shipping      only when this merchant bears it (§8)
 *   cod_collected  −subtotal      only when the *merchant* collected the cash itself
 *
 * Writing three rows rather than one net row is the whole point of having a ledger: a merchant querying
 * why it is owed €8.50 on a €10 sale gets an answer, and BioCode's commission income is a sum over one
 * `kind` rather than a difference between two other numbers.
 *
 * Idempotent on `(fulfilment_id, kind)`: the trigger fires on a status change, and a delivered
 * fulfilment that is somehow updated again must not pay twice. Enforced by an index rather than by
 * checking first, because two concurrent callers both pass a check.
 */
create unique index if not exists merchant_ledger_once
  on merchant_ledger (fulfilment_id, kind)
  where fulfilment_id is not null;

create or replace function public.post_fulfilment_to_ledger(p_fulfilment_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f order_fulfilments%rowtype;
  v_merchant merchants%rowtype;
  v_settlement jsonb;
  v_shipping int;
  v_is_cod boolean;
  v_rows int := 0;
begin
  select * into v_f from order_fulfilments where id = p_fulfilment_id;
  if v_f.id is null or v_f.fulfiller_kind <> 'merchant' or v_f.merchant_id is null then
    return 0;
  end if;
  if v_f.status <> 'delivered' then
    return 0;
  end if;

  select * into v_merchant from merchants where id = v_f.merchant_id;
  if v_merchant.id is null then
    return 0;
  end if;

  /*
   * Recomputed here rather than read off the fulfilment.
   *
   * The fulfilment's stored `commission_cents` is what the routing screen showed, and it is right —
   * but the ledger is the record a payment is made against, and computing it from the one function
   * that owns the arithmetic means a change to `merchant_settlement` cannot leave the two disagreeing
   * about a fulfilment delivered after the change.
   */
  v_settlement := public.merchant_settlement(v_f.merchant_id, v_f.items_subtotal_cents);
  v_shipping := coalesce((v_settlement->>'shipping_cents')::int, 0);

  v_is_cod := exists (
    select 1 from payments p
     where p.order_id = v_f.order_id and p.provider = 'cod' and p.status in ('pending', 'paid')
  );

  insert into merchant_ledger (merchant_id, fulfilment_id, kind, amount_cents, note)
  values (
    v_f.merchant_id, p_fulfilment_id, 'sale', v_f.items_subtotal_cents,
    'Items delivered'
  )
  on conflict do nothing;
  v_rows := v_rows + 1;

  insert into merchant_ledger (merchant_id, fulfilment_id, kind, amount_cents, note)
  values (
    v_f.merchant_id, p_fulfilment_id, 'commission',
    -coalesce((v_settlement->>'commission_cents')::int, 0),
    v_merchant.commission_pct || '% of the item subtotal'
  )
  on conflict do nothing;
  v_rows := v_rows + 1;

  if v_shipping > 0 then
    insert into merchant_ledger (merchant_id, fulfilment_id, kind, amount_cents, note)
    values (
      v_f.merchant_id, p_fulfilment_id, 'shipping', -v_shipping,
      'Shipping borne by the merchant'
    )
    on conflict do nothing;
    v_rows := v_rows + 1;
  end if;

  /*
   * The merchant collected the cash itself, so it is holding money that is not all its own. The
   * subtotal comes off its balance and what remains is the negative of the commission — which is
   * exactly what it owes BioCode.
   */
  if v_is_cod and v_merchant.collects_cash then
    insert into merchant_ledger (merchant_id, fulfilment_id, kind, amount_cents, note)
    values (
      v_f.merchant_id, p_fulfilment_id, 'cod_collected', -v_f.items_subtotal_cents,
      'Cash collected by the merchant on delivery'
    )
    on conflict do nothing;
    v_rows := v_rows + 1;
  end if;

  return v_rows;
end $$;

comment on function public.post_fulfilment_to_ledger is
  'Posts a delivered merchant fulfilment to the ledger. Idempotent per (fulfilment, kind). docs/16 §8.';

revoke all on function public.post_fulfilment_to_ledger(uuid) from public, anon;
grant execute on function public.post_fulfilment_to_ledger(uuid) to authenticated, service_role;

/*
 * Fired by delivery, from whichever actor recorded it — support on the order screen, a courier webhook,
 * or the cron. A trigger rather than a call in each, because the third caller is the one that forgets,
 * and a fulfilment delivered but never posted is a merchant who is simply not paid.
 */
create or replace function public.fulfilments_post_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    perform public.post_fulfilment_to_ledger(new.id);
  end if;
  return null;
end $$;

create trigger order_fulfilments_post_ledger
  after update of status on order_fulfilments
  for each row execute function public.fulfilments_post_ledger();

/*
 * Delivery of an *order* delivers its fulfilments.
 *
 * Support marks an order delivered on the existing admin screen, and that has to reach the merchant
 * side: without this, a merchant's parcel stays `shipped` forever and its ledger stays empty. Only
 * fulfilments that were actually shipped — a cancelled one is not delivered by the order completing.
 */
create or replace function public.orders_deliver_fulfilments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    update order_fulfilments
       set status = 'delivered'
     where order_id = new.id
       and status = 'shipped';
  end if;
  return null;
end $$;

create trigger orders_deliver_fulfilments
  after update of status on orders
  for each row execute function public.orders_deliver_fulfilments();

-- -----------------------------------------------------------------------------
-- A refund claws its share back
-- -----------------------------------------------------------------------------

/*
 * A refunded order means the merchant's share comes back, and the ledger says so with a row rather
 * than by editing history.
 *
 * Proportional to what the fulfilment sold, not to the order total: a €10 refund on a €40 order where
 * the merchant supplied €20 of it claws back €5, and the commission on it comes back to the merchant
 * in the same proportion. Computed as "reverse the whole fulfilment × the refunded fraction", so a
 * full refund reverses exactly what was posted and leaves a zero balance rather than a rounding
 * residue.
 */
create or replace function public.post_refund_to_ledger(
  p_order_id uuid,
  p_refund_cents int,
  p_note text default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_f record;
  v_fraction numeric;
  v_posted int := 0;
  v_reverse int;
begin
  if not (
    is_service_role()
    or has_any_role(array['support','admin']::user_role[])
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_order from orders where id = p_order_id;
  if v_order.id is null or coalesce(v_order.subtotal_cents, 0) = 0 then
    return 0;
  end if;

  -- Against the item subtotal, because that is what the ledger's `sale` rows sum to.
  v_fraction := least(1.0, greatest(0.0, p_refund_cents::numeric / v_order.subtotal_cents));
  if v_fraction = 0 then
    return 0;
  end if;

  for v_f in
    select f.id, f.merchant_id,
           coalesce(sum(l.amount_cents), 0)::int as posted_cents
      from order_fulfilments f
      join merchant_ledger l on l.fulfilment_id = f.id and l.kind <> 'refund'
     where f.order_id = p_order_id
       and f.fulfiller_kind = 'merchant'
     group by f.id, f.merchant_id
  loop
    v_reverse := round(v_f.posted_cents * v_fraction)::int;
    if v_reverse = 0 then
      continue;
    end if;

    insert into merchant_ledger (merchant_id, fulfilment_id, kind, amount_cents, note)
    values (
      v_f.merchant_id, v_f.id, 'refund', -v_reverse,
      coalesce(p_note, 'Customer refund') || ' (' || round(v_fraction * 100) || '% of the order)'
    );
    v_posted := v_posted + 1;
  end loop;

  return v_posted;
end $$;

comment on function public.post_refund_to_ledger is
  'Claws a merchant''s share back proportionally when an order is refunded. docs/16 §8.';

revoke all on function public.post_refund_to_ledger(uuid, int, text) from public, anon;
grant execute on function public.post_refund_to_ledger(uuid, int, text) to authenticated, service_role;

/*
 * `refund` rows carry a `fulfilment_id` that already has `sale` and `commission` rows against it, so
 * the `(fulfilment_id, kind)` uniqueness above would refuse a second partial refund on the same
 * fulfilment. `kind` differs, so the first refund is admitted — but the second would collide, and a
 * customer refunded twice is not a hypothetical.
 *
 * The index is therefore narrowed to the kinds that must be posted exactly once. Refunds and
 * adjustments are inherently repeatable.
 */
drop index if exists merchant_ledger_once;
create unique index merchant_ledger_once
  on merchant_ledger (fulfilment_id, kind)
  where fulfilment_id is not null
    and kind in ('sale', 'commission', 'shipping', 'cod_collected');

/** Fires on a refund row, which the existing `refunds_after_insert` trigger already validates. */
create or replace function public.refunds_post_merchant_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.post_refund_to_ledger(new.order_id, new.amount_cents, 'Refund');
  return null;
end $$;

create trigger refunds_post_merchant_ledger
  after insert on refunds
  for each row execute function public.refunds_post_merchant_ledger();

-- -----------------------------------------------------------------------------
-- The balance, and the statement behind it
-- -----------------------------------------------------------------------------

/*
 * What a merchant is owed right now: every ledger row, including previous payouts.
 *
 * A `payout` row is negative — money that has left BioCode — so the balance is a plain sum and needs no
 * "except the paid ones" clause. That is the property the signed single column buys.
 */
create or replace function public.merchant_balance(p_merchant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'merchant_id', p_merchant_id,
    'balance_cents', coalesce(sum(amount_cents), 0)::int,
    'sales_cents', coalesce(sum(amount_cents) filter (where kind = 'sale'), 0)::int,
    'commission_cents', coalesce(sum(amount_cents) filter (where kind = 'commission'), 0)::int,
    'shipping_cents', coalesce(sum(amount_cents) filter (where kind = 'shipping'), 0)::int,
    'cod_cents', coalesce(sum(amount_cents) filter (where kind = 'cod_collected'), 0)::int,
    'refunds_cents', coalesce(sum(amount_cents) filter (where kind = 'refund'), 0)::int,
    'adjustments_cents', coalesce(sum(amount_cents) filter (where kind = 'adjustment'), 0)::int,
    'paid_out_cents', coalesce(sum(amount_cents) filter (where kind = 'payout'), 0)::int,
    'entry_count', count(*)
  )
  from merchant_ledger
  where merchant_id = p_merchant_id
$$;

comment on function public.merchant_balance is
  'A merchant''s ledger balance, broken down by kind. Payouts are negative, so the balance is a plain sum. docs/16 §8.';

revoke all on function public.merchant_balance(uuid) from public, anon;
grant execute on function public.merchant_balance(uuid) to authenticated, service_role;

/*
 * Build a payout for one merchant and one period.
 *
 * ── What "building" means, exactly ──
 *
 * It gathers the **unpaid** ledger rows dated in the period, writes one `merchant_payouts` row for
 * their net, and posts a matching negative `payout` row to the ledger. That last step is what keeps
 * the balance honest: after building, the merchant's balance drops by exactly what the statement says,
 * with no state anywhere saying "these rows are spoken for".
 *
 * ── Why the payout row is `pending`, not `paid` ──
 *
 * Money has not moved. Somebody has to make a bank transfer and come back with a reference, which is
 * `mark_payout_paid`. Building and paying are separate because they are done by different people at
 * different times, and a function that did both would mean a statement could only exist if the transfer
 * had already happened.
 *
 * A period with nothing in it produces **no row at all** rather than a zero statement. A merchant
 * receiving a €0.00 statement every fortnight learns to ignore statements.
 */
create or replace function public.build_merchant_payout(
  p_merchant_id uuid,
  p_period_start date,
  p_period_end date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_gross int;
  v_commission int;
  v_other int;
  v_net int;
  v_payout_id uuid;
begin
  if not (is_service_role() or has_any_role(array['admin']::user_role[])) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_period_end < p_period_start then
    raise exception 'INVALID_PERIOD';
  end if;

  /*
   * `kind <> 'payout'` is what makes this repeatable: rows already covered by an earlier payout were
   * balanced by that payout's own negative row, so summing everything except payouts over an
   * *unclosed* period would double-count. The period bounds plus the exclusion give "what is owed for
   * this fortnight and has not been settled".
   */
  select
    coalesce(sum(amount_cents) filter (where kind = 'sale'), 0)::int,
    coalesce(sum(amount_cents) filter (where kind = 'commission'), 0)::int,
    coalesce(sum(amount_cents) filter (where kind in ('shipping','cod_collected','refund','adjustment')), 0)::int
    into v_gross, v_commission, v_other
    from merchant_ledger
   where merchant_id = p_merchant_id
     and kind <> 'payout'
     and created_at >= p_period_start::timestamptz
     and created_at < (p_period_end + 1)::timestamptz
     and not exists (
       select 1 from merchant_payouts mp
        where mp.merchant_id = merchant_ledger.merchant_id
          and mp.status <> 'on_hold'
          and merchant_ledger.created_at >= mp.period_start::timestamptz
          and merchant_ledger.created_at < (mp.period_end + 1)::timestamptz
     );

  v_net := v_gross + v_commission + v_other;

  if v_gross = 0 and v_other = 0 then
    return jsonb_build_object('created', false, 'reason', 'nothing_to_settle');
  end if;

  insert into merchant_payouts (
    merchant_id, period_start, period_end, gross_cents, commission_cents, net_cents, status
  ) values (
    p_merchant_id, p_period_start, p_period_end, v_gross, -v_commission, v_net, 'pending'
  )
  returning id into v_payout_id;

  /*
   * The balancing ledger row, dated **now** rather than inside the period, so a second build of the
   * same period cannot pick it up as unsettled and so the merchant's running balance moves on the day
   * the statement was cut.
   */
  insert into merchant_ledger (merchant_id, kind, amount_cents, note, created_by)
  values (
    p_merchant_id, 'payout', -v_net,
    'Payout ' || p_period_start || ' – ' || p_period_end,
    v_actor
  );

  return jsonb_build_object(
    'created', true,
    'payout_id', v_payout_id,
    'gross_cents', v_gross,
    'commission_cents', -v_commission,
    'net_cents', v_net
  );
end $$;

comment on function public.build_merchant_payout is
  'Builds one pending payout from unsettled ledger rows in a period, and balances the ledger. docs/16 §8.';

revoke all on function public.build_merchant_payout(uuid, date, date) from public, anon;
grant execute on function public.build_merchant_payout(uuid, date, date) to authenticated, service_role;

/*
 * Builds a payout for every merchant with something owed. What the cron calls.
 *
 * Returns the ids it created so the caller can report them, and skips merchants with nothing rather
 * than writing empty statements.
 */
create or replace function public.build_all_merchant_payouts(
  p_period_start date,
  p_period_end date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant record;
  v_result jsonb;
  v_created jsonb := '[]'::jsonb;
begin
  if not (is_service_role() or has_any_role(array['admin']::user_role[])) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  for v_merchant in
    select distinct m.id, m.display_name
      from merchants m
      join merchant_ledger l on l.merchant_id = m.id
     -- Suspended merchants still get paid for what they delivered; rejected ones never delivered.
     where m.status in ('approved', 'suspended')
     order by m.display_name
  loop
    v_result := public.build_merchant_payout(v_merchant.id, p_period_start, p_period_end);
    if (v_result->>'created')::boolean then
      v_created := v_created || jsonb_build_array(
        jsonb_build_object(
          'merchant_id', v_merchant.id,
          'merchant_name', v_merchant.display_name,
          'payout_id', v_result->>'payout_id',
          'net_cents', (v_result->>'net_cents')::int
        )
      );
    end if;
  end loop;

  return jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end, 'payouts', v_created);
end $$;

comment on function public.build_all_merchant_payouts is
  'Builds the fortnightly payout run. Skips merchants with nothing owed. docs/16 §8.';

revoke all on function public.build_all_merchant_payouts(date, date) from public, anon;
grant execute on function public.build_all_merchant_payouts(date, date) to authenticated, service_role;

/*
 * Records that a transfer happened.
 *
 * Admin-only, and it requires a **reference**: the bank's transaction id or a note somebody can look
 * up. A payout marked paid with nothing to trace it by is the state every reconciliation argument
 * starts from.
 *
 * It writes no ledger row. The money left the balance when the payout was *built* — posting again here
 * would pay the merchant twice on paper.
 */
create or replace function public.mark_payout_paid(
  p_payout_id uuid,
  p_reference text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (is_service_role() or has_any_role(array['admin']::user_role[])) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_reference is null or length(trim(p_reference)) < 3 then
    raise exception 'REFERENCE_REQUIRED';
  end if;

  update merchant_payouts
     set status = 'paid',
         paid_at = now(),
         reference = trim(p_reference)
   where id = p_payout_id
     and status in ('pending', 'approved');

  if not found then
    raise exception 'PAYOUT_NOT_PAYABLE';
  end if;
end $$;

comment on function public.mark_payout_paid is
  'Records a completed transfer against a payout. Requires a reference. docs/16 §8.';

revoke all on function public.mark_payout_paid(uuid, text) from public, anon;
grant execute on function public.mark_payout_paid(uuid, text) to authenticated, service_role;

/*
 * One statement, as a merchant reads it: the payout row plus the ledger rows it settled.
 *
 * Security definer and scoped to `current_merchant_ids()` **or** staff, so one function serves the
 * merchant's own statement page and the admin's view of it. The alternative — two queries — is how the
 * number a merchant sees and the number BioCode paid come to differ by a rounding rule.
 */
create or replace function public.merchant_statement(p_payout_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_payout merchant_payouts%rowtype;
  v_merchant merchants%rowtype;
begin
  select * into v_payout from merchant_payouts where id = p_payout_id;
  if v_payout.id is null then
    return null;
  end if;

  if not (
    is_service_role()
    or (select is_staff())
    or v_payout.merchant_id = any (public.current_merchant_ids())
  ) then
    -- Null rather than an exception: a merchant probing another's payout id learns nothing.
    return null;
  end if;

  select * into v_merchant from merchants where id = v_payout.merchant_id;

  return jsonb_build_object(
    'payout', jsonb_build_object(
      'id', v_payout.id,
      'period_start', v_payout.period_start,
      'period_end', v_payout.period_end,
      'gross_cents', v_payout.gross_cents,
      'commission_cents', v_payout.commission_cents,
      'net_cents', v_payout.net_cents,
      'status', v_payout.status,
      'paid_at', v_payout.paid_at,
      'reference', v_payout.reference,
      'created_at', v_payout.created_at
    ),
    'merchant', jsonb_build_object(
      'display_name', v_merchant.display_name,
      'legal_name', v_merchant.legal_name,
      'commission_pct', v_merchant.commission_pct,
      -- Last four only, on a document that gets emailed and printed.
      'iban_last4', right(coalesce(v_merchant.iban, ''), 4)
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'kind', l.kind,
        'amount_cents', l.amount_cents,
        'note', l.note,
        'created_at', l.created_at,
        'order_number', o.order_number
      ) order by l.created_at, l.kind)
        from merchant_ledger l
        left join order_fulfilments f on f.id = l.fulfilment_id
        left join orders o on o.id = f.order_id
       where l.merchant_id = v_payout.merchant_id
         and l.kind <> 'payout'
         and l.created_at >= v_payout.period_start::timestamptz
         and l.created_at < (v_payout.period_end + 1)::timestamptz
    ), '[]'::jsonb)
  );
end $$;

comment on function public.merchant_statement is
  'One payout and the ledger rows behind it. Own statement for a merchant, any for staff. docs/16 §8.';

revoke all on function public.merchant_statement(uuid) from public, anon;
grant execute on function public.merchant_statement(uuid) to authenticated, service_role;
