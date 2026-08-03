-- =============================================================================
-- 43 · M12 · Auto-routing, behind the setting that is off
-- Source: docs/16 §6, §12 step 8.
-- =============================================================================

/*
 * ── Why this is off by default and stays off ──
 *
 * `settings.marketplace.auto_route` is `false`, and the seed comment says why: *"automation that assigns a
 * customer's order to a supplier is not something to switch on before somebody has watched the screen do
 * it by hand for a while."* This migration builds the automation and leaves the switch where it is.
 *
 * That is not caution for its own sake. Manual routing is where the operator learns which merchants
 * actually answer, which ones ship late, and whether the candidate list is telling the truth — and the
 * scorecard that auto-routing depends on (§6) needs a few weeks of real fulfilments before its numbers mean
 * anything. Turning this on first would be automating a judgement nobody has made yet.
 *
 * ── What it does when it is on ──
 *
 * Assigns every `unassigned` merchant fulfilment to its **best candidate**, using
 * `fulfilment_candidates` — the same list, in the same order, that the routing screen shows a human. It
 * calls `assign_fulfilment`, so the stock reservation moves and the commission is recomputed by exactly the
 * code path a manual assignment uses.
 *
 * ── What it deliberately will not do ──
 *
 *   · **Escalate.** A fulfilment a merchant has been sitting on is left alone. Taking an order off a
 *     merchant that has not answered is a commercial judgement about a counterparty, and the reminder email
 *     (§7) is the automated response to silence.
 *   · **Route to a merchant that cannot cover every line.** `assign_fulfilment` refuses, and this reports
 *     the refusal rather than splitting the fulfilment to make the automation succeed.
 *   · **Override a human.** Only `unassigned` rows are touched, so a fulfilment somebody has already
 *     assigned — even to a worse candidate — stays where they put it.
 */
create or replace function public.auto_route_fulfilments()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_enabled boolean;
  v_fulfilment record;
  v_candidate record;
  v_routed jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if not (is_service_role() or has_any_role(array['admin']::user_role[])) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select value into v_config from settings where key = 'marketplace';
  v_enabled := coalesce((v_config->>'auto_route')::boolean, false);

  if not v_enabled then
    -- Reported, not silent: a cron that "succeeded" while doing nothing is indistinguishable from a broken
    -- one, and somebody will eventually ask why nothing was routed.
    return jsonb_build_object('enabled', false, 'routed', '[]'::jsonb, 'skipped', '[]'::jsonb);
  end if;

  for v_fulfilment in
    select f.id, f.order_id
      from order_fulfilments f
      join orders o on o.id = f.order_id
     where f.fulfiller_kind = 'merchant'
       and f.status = 'unassigned'
       and o.status not in ('cancelled', 'refunded')
     order by f.created_at asc
  loop
    /*
     * The **best** candidate, which is the first row `fulfilment_candidates` returns: cheapest to source,
     * then better-rated, then alphabetical. Reading it rather than re-deriving it is what keeps the
     * automation and the screen agreeing about who should get the order.
     */
    select * into v_candidate
      from public.fulfilment_candidates(v_fulfilment.id)
     limit 1;

    if v_candidate.merchant_id is null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'fulfilment_id', v_fulfilment.id,
        'reason', 'no_candidate'
      ));
      continue;
    end if;

    /*
     * Each assignment in its own block, so one refusal does not abandon the rest of the queue. A run that
     * stopped at the first problem would leave the orders behind it unrouted for a day, and nobody would
     * know which ones.
     */
    begin
      perform public.assign_fulfilment(v_fulfilment.id, v_candidate.merchant_id);
      v_routed := v_routed || jsonb_build_array(jsonb_build_object(
        'fulfilment_id', v_fulfilment.id,
        'merchant_id', v_candidate.merchant_id,
        'merchant_name', v_candidate.merchant_name
      ));
    exception when others then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'fulfilment_id', v_fulfilment.id,
        'merchant_id', v_candidate.merchant_id,
        'reason', sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object('enabled', true, 'routed', v_routed, 'skipped', v_skipped);
end $$;

comment on function public.auto_route_fulfilments is
  'Assigns unassigned merchant fulfilments to their best candidate, when settings.marketplace.auto_route is on. docs/16 §6.';

revoke all on function public.auto_route_fulfilments() from public, anon;
grant execute on function public.auto_route_fulfilments() to authenticated, service_role;

/*
 * The switch, as a function, so an admin screen can flip it without a general settings write.
 *
 * `settings` grants write to admin only, so this adds no privilege — what it adds is a **single place** the
 * flag is written, which matters because turning routing over to a machine is a decision worth having one
 * audited path for rather than a jsonb merge somebody performs by hand.
 */
create or replace function public.set_auto_routing(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (is_service_role() or has_any_role(array['admin']::user_role[])) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update settings
     set value = jsonb_set(coalesce(value, '{}'::jsonb), '{auto_route}', to_jsonb(p_enabled)),
         updated_at = now()
   where key = 'marketplace';

  if not found then
    raise exception 'MARKETPLACE_SETTINGS_MISSING';
  end if;

  return p_enabled;
end $$;

comment on function public.set_auto_routing is
  'Turns auto-routing on or off. Admin only. docs/16 §6.';

revoke all on function public.set_auto_routing(boolean) from public, anon;
grant execute on function public.set_auto_routing(boolean) to authenticated, service_role;
