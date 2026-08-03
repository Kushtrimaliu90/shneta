-- =============================================================================
-- 25 · M12 · The `merchant` role — alone in its own migration, on purpose
-- Source: docs/16 §2.
-- =============================================================================

/*
 * `alter type … add value` **cannot be used in the transaction that added it.**
 *
 * Postgres allows the ALTER inside a transaction (since 12), but any reference to the new label
 * before that transaction commits fails with "unsafe use of new value of enum type". Supabase runs
 * each migration file as one transaction, so a file that adds `merchant` and then writes a policy
 * mentioning `'merchant'::user_role` fails on its last statement having looked fine in review.
 *
 * Hence a migration that does exactly one thing. Everything that names the role lives in the next
 * file, which runs in its own transaction and can therefore see it.
 */
alter type user_role add value if not exists 'merchant';

/*
 * `is_staff()` is deliberately left alone.
 *
 * It enumerates the roles that may see `/admin`, and a merchant is not one of them — they are a
 * counterparty, not a colleague. Adding `merchant` here would silently hand every merchant read
 * access to the staff-read policies on the whole catalogue, the order queue and the audit log,
 * because most of them are written as `using (is_staff())`.
 *
 * `has_any_role()` needs no change either: it already treats `admin` as satisfying every check,
 * and `merchant` will only ever appear in policies that name it explicitly.
 *
 * Recorded here rather than in a comment on the next file because this is the omission that would
 * otherwise look like an oversight to whoever reads `is_staff` next.
 */
