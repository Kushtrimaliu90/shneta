-- =============================================================================
-- 71 · How a merchant wants to be settled
-- Source: docs/16 §8 — some merchants would rather take cash than a transfer.
-- =============================================================================

/*
 * ── Why not simply make the bank fields optional ──
 *
 * The application demanded a bank name and an IBAN from everyone, which is wrong for a merchant who
 * intends to settle in cash. The obvious fix — drop `required` — is worse than the problem: a blank
 * IBAN would then mean two different things, "prefers cash" and "forgot", and the person who has to
 * pay the merchant cannot tell which from the row. The merchant who *did* want a transfer would also
 * be free to submit without one and discover it at their first payout.
 *
 * So the choice is recorded instead of inferred. Bank details stay required for a bank transfer and
 * are not asked for at all for cash, and a blank IBAN becomes a fact rather than an ambiguity.
 *
 * ── Not `collects_cash`, which already exists and means something else ──
 *
 * `collects_cash` answers *who takes money from the customer* — true only for the docs/16 §8 variant
 * where the merchant's own courier collects, which inverts the sign of the ledger entry. This answers
 * *how BioCode settles the net balance with the merchant*. They are independent: a merchant can ship
 * their own orders, have BioCode's courier collect the cash, and still want to be paid by transfer.
 * Overloading one column with both questions would make the ledger wrong the first time a merchant
 * picked an unusual combination.
 */

create type merchant_settlement_method as enum ('bank_transfer', 'cash');

alter table merchants
  add column settlement_method merchant_settlement_method not null default 'bank_transfer';

comment on column merchants.settlement_method is
  'How BioCode settles the net balance with this merchant. Distinct from collects_cash, which is who takes money from the customer.';

/*
 * The constraint is the point of the whole change.
 *
 * Without it, "bank transfer" and "no account number" can coexist in a row, and the failure surfaces
 * at the one moment it is most expensive: an operator sitting on an approved payout with nowhere to
 * send it. Enforced here rather than only in the Zod schema because the schema guards one caller —
 * the application form — and the admin panel, the settings form and a psql session are three more.
 *
 * `nullif(btrim(...), '')` rather than `is not null`: an empty string is not a bank account, and a
 * form post is perfectly capable of supplying one.
 */
alter table merchants
  add constraint merchants_bank_details_for_transfer check (
    settlement_method <> 'bank_transfer'
    or (nullif(btrim(coalesce(iban, '')), '') is not null
        and nullif(btrim(coalesce(bank_name, '')), '') is not null)
  );

/*
 * Every existing merchant applied under the old rules, so all of them have both fields and all of
 * them default to `bank_transfer` — which is also the truth about them. Verified against the live
 * table before this was written: three rows, zero missing an IBAN or a bank name.
 */
