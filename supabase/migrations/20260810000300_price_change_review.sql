-- 80 · A price change on a live offer goes back through review
--
-- `settings.marketplace.price_change_review` has existed since migration 47, defaulting to `false`, with
-- the decision deferred: "turning it on is a §6 decision". The owner made it on 2026-08-10 — a merchant
-- may edit the price of an approved offer, and the offer returns to review when they do.
--
-- ── Why a trigger and not the action ──
--
-- `updateOffer` is one of three ways a price changes. `merchant_bulk_upsert_offers` writes
-- `price_cents = coalesce(v_price, price_cents)` straight onto approved rows, and
-- `merchant_bulk_create_offers` and any future caller reach the same column. Putting the rule in the
-- action would mean the single form re-reviews and a pasted sheet of two hundred new prices does not —
-- which is the larger hole, and the one nobody would notice.
--
-- ── Stock is deliberately exempt ──
--
-- Only `price_cents` triggers it. A merchant updating stock nightly from its own sheet is the ordinary
-- use of this marketplace, and putting every offer into review each evening would make the review queue
-- useless and the portal hostile. `handling_days` is a customer-facing promise and arguably belongs here
-- too; it is left out until somebody asks, because the owner asked about prices.
--
-- ── What this costs the merchant, stated plainly ──
--
-- `variant_buy_box` requires `status = 'approved'`, so an offer in `pending_review` is not for sale. A
-- merchant correcting a typo takes their own product off the shelf until a reviewer looks. That is the
-- behaviour asked for, and the form now says so before they save.
--
-- The alternative — keep selling at the approved price while the new one waits — needs a second price
-- column and a buy box that reads the approved one. Better for everybody and a larger change; recorded
-- in docs/13 §AG rather than smuggled in here.

create or replace function public.demote_offer_on_price_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  -- Only a live offer, and only when the money actually moved.
  if old.status <> 'approved' or new.price_cents = old.price_cents then
    return new;
  end if;

  /*
   * Read from settings rather than hardcoded, so switching it back is a settings edit and not a
   * migration. Defaults to the behaviour the owner asked for if the key is missing, because a missing
   * key must not silently let prices change on live offers unreviewed.
   */
  select coalesce((value->>'price_change_review')::boolean, true)
    into v_enabled
    from settings
   where key = 'marketplace';

  if not coalesce(v_enabled, true) then
    return new;
  end if;

  /*
   * Status only. `approved_at` and `approved_by` are left as the record of the last approval — and,
   * more practically, `merchant_offers_write_guard` raises OFFER_APPROVAL_FORBIDDEN if a merchant's
   * statement changes either of them. BEFORE triggers fire in name order, so this one is named to sort
   * after that guard; setting only `status` means the order does not actually matter, which is the point.
   * A future edit here that touches the approval columns would depend on the ordering, so it is written
   * down rather than left to be rediscovered.
   *
   * `pending_review` and not `draft`: the merchant has asked to sell at this price. A draft would make
   * them submit it a second time to say the thing they already said.
   */
  new.status := 'pending_review';
  new.rejection_note := null;

  return new;
end $$;

comment on function public.demote_offer_on_price_change is
  'Returns an approved offer to pending_review when its price changes, per '
  'settings.marketplace.price_change_review. Stock and handling days are exempt. docs/16 §6.';

-- Named to sort after `merchant_offers_write_guard`, which is what `zz` is doing here.
drop trigger if exists merchant_offers_zz_price_review on merchant_offers;
create trigger merchant_offers_zz_price_review
  before update of price_cents on merchant_offers
  for each row execute function public.demote_offer_on_price_change();

-- The owner's decision, 2026-08-10.
update settings
   set value = jsonb_set(value, '{price_change_review}', 'true'::jsonb)
 where key = 'marketplace';
