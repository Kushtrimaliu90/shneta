-- =============================================================================
-- 31 · M12 · What the applicant told us, in its own column
-- Source: docs/16 §4.
-- =============================================================================

/*
 * The narrative part of an application: which categories they intend to sell, how large a catalogue
 * they expect, and whether they import directly rather than buying from a local distributor.
 *
 * A column of its own rather than any of the places it nearly fits:
 *
 *   · `rejection_note` holds **what the reviewer said**, and overwriting it with what the applicant
 *     said would destroy the reviewer's note the first time an admin asked for more information.
 *   · The `address` jsonb is an address.
 *   · A `merchant_documents` row of kind `other` would bury it behind a signed URL, when the whole
 *     point is that the reviewer reads it on the screen where they decide.
 *
 * Free text, because it is free text: three prose answers a human weighs. Structuring it into
 * category ids and a size enum would suggest a precision the answers do not have, and the import
 * claim is verified by the licence document rather than by the checkbox.
 */

alter table merchants
  add column if not exists application_note text;

comment on column merchants.application_note is
  'The applicant''s own account of what they intend to sell. Distinct from rejection_note, which is the reviewer''s.';
