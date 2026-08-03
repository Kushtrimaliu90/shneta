-- =============================================================================
-- 29 · M12 · Who bears the shipping cost — a decision, per merchant
-- Source: docs/16 §8.
-- =============================================================================

/*
 * Three options, set by the admin: BioCode covers it, the merchant covers it, or the customer does.
 *
 * A **per-merchant column with a global default**, because this is negotiated the same way the
 * commission is. A single global switch would mean the merchant who agreed to absorb shipping and
 * the one who did not are treated identically, and the first time that mattered somebody would add
 * the column anyway. `null` means "use the marketplace default", so changing the default moves
 * every merchant who has not negotiated something else.
 */

create type shipping_borne_by as enum ('biocode', 'merchant', 'customer');

alter table merchants
  add column if not exists shipping_borne_by shipping_borne_by;

comment on column merchants.shipping_borne_by is
  'Who bears this merchant''s fulfilment shipping cost. Null = settings.marketplace default.';

/*
 * What the three actually mean at settlement, because only two of them touch the ledger:
 *
 *   biocode   No deduction. BioCode pays the courier out of the shipping fee it charged the
 *             customer, and keeps whatever is left. The merchant's due is subtotal − commission.
 *
 *   merchant  A `shipping` ledger row for −cost against the merchant, so its due is
 *             subtotal − commission − shipping. This is the only option that changes what the
 *             merchant is paid.
 *
 *   customer  Covered by the shipping fee already collected at checkout, and recorded as such.
 *             The merchant is deducted nothing, so the ledger effect matches `biocode`; what
 *             differs is the attribution, which is why it is a distinct value rather than an alias.
 *
 * **`customer` does not add a surcharge at checkout, and cannot in v1.** The customer is charged
 * one shipping fee before routing happens — admin picks the merchant *after* the order exists
 * (docs/16 §6) — so there is no per-merchant shipping line to add at the moment money is taken.
 * Charging one would mean either routing before checkout or a second charge afterwards, and neither
 * is something to build on the way past. Recorded here rather than left for someone to discover.
 */

/*
 * The courier cost of one merchant fulfilment, in cents.
 *
 * Deliberately a flat per-fulfilment number rather than a zone or weight calculation. The real
 * shipping engine already prices the customer's delivery (docs/07 §5); this is the internal cost
 * used to settle with a merchant, and a flat figure is what a commercial agreement of this size is
 * written in. It is a setting so it does not need a migration to change.
 */

update settings
set value = value
  - 'shipping_cost_absorbed'
  - 'shipping_deduction_cents'
  || jsonb_build_object(
       'shipping_borne_by', 'biocode',
       'shipping_cost_cents', 200
     ),
    updated_at = now()
where key = 'marketplace';

/*
 * `shipping_cost_absorbed` and `shipping_deduction_cents` are removed rather than left beside the
 * new key. Two ways to express the same decision is how a setting ends up read from the wrong one —
 * and the boolean could not express three options in the first place, which is the whole reason
 * this migration exists.
 */

-- -----------------------------------------------------------------------------
-- Settlement, as one function so the arithmetic lives in one place
-- -----------------------------------------------------------------------------

/*
 * What a merchant is owed for one fulfilment.
 *
 * Commission is a percentage of the **item subtotal**, never of the shipping fee — a merchant that
 * ships its own parcels would otherwise pay commission on postage. Worked example from the brief:
 * a €10 item at 10% leaves the merchant €9.
 *
 * `round()` on a numeric, then cast to int, so the half-cent goes the same way every time. Money is
 * integer cents throughout this codebase (CLAUDE.md §2) and this is the one place in the
 * marketplace where a division happens, so it is the one place a rounding rule can hide.
 *
 * Returns the three numbers together because they must agree: `due = subtotal − commission −
 * shipping`, and computing them in separate places is how a statement stops reconciling.
 */
create or replace function public.merchant_settlement(
  p_merchant_id uuid,
  p_items_subtotal_cents int
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m record;
  cfg jsonb;
  borne text;
  ship_cost int;
  commission int;
begin
  select commission_pct, shipping_borne_by into m from merchants where id = p_merchant_id;
  if m is null then
    return null;
  end if;

  select value into cfg from settings where key = 'marketplace';
  cfg := coalesce(cfg, '{}'::jsonb);

  borne := coalesce(m.shipping_borne_by::text, cfg->>'shipping_borne_by', 'biocode');
  ship_cost := coalesce((cfg->>'shipping_cost_cents')::int, 0);

  commission := round(p_items_subtotal_cents * m.commission_pct / 100.0)::int;

  return jsonb_build_object(
    'items_subtotal_cents', p_items_subtotal_cents,
    'commission_pct', m.commission_pct,
    'commission_cents', commission,
    'shipping_borne_by', borne,
    -- Only `merchant` moves money away from the merchant; the other two are BioCode's problem.
    'shipping_cents', case when borne = 'merchant' then ship_cost else 0 end,
    'merchant_due_cents', p_items_subtotal_cents
      - commission
      - case when borne = 'merchant' then ship_cost else 0 end
  );
end $$;

comment on function public.merchant_settlement is
  'Commission and shipping for one fulfilment subtotal. The only place the arithmetic lives. docs/16 §8.';

/*
 * `shipping` joins the ledger kinds.
 *
 * A check constraint cannot be extended, so it is dropped and rebuilt with the same name. The list
 * is otherwise unchanged.
 */
alter table merchant_ledger drop constraint merchant_ledger_kind_check;
alter table merchant_ledger add constraint merchant_ledger_kind_check
  check (kind in ('sale', 'commission', 'shipping', 'cod_collected', 'refund', 'adjustment', 'payout'));
