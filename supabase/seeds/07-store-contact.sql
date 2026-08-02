-- ---------------------------------------------------------------------------------------------
-- Corrects the shop's contact details on a database that has already been seeded.
--
-- `seed.sql` carries the right values now, and that is enough for a fresh `db reset`. It is not
-- enough for the linked project, because of a workflow behaviour worth stating plainly:
--
--   **`supabase db push --include-seed` does not re-run a seed file whose contents changed.**
--   It prints "Updating seed hash to …", records the new hash, and moves on. Only a file it has
--   never seen is executed ("Seeding data from …").
--
-- So a correction to an existing seed file reaches new environments and silently never reaches
-- the one that is live. Verified the hard way: `seed.sql`'s store block was edited, pushed, and
-- the live row still read `info@biocode.com` afterwards. In practice, seed corrections behave
-- like migrations and have to be numbered like them — hence this file.
--
-- What changed and why: the row held `info@biocode.com`, `+383 40 000 000` and three social URLs
-- under `/biocode`. The domain was never registered, the number dials nowhere and the accounts do
-- not exist. Every surface that renders these does so conditionally, so empty means "not shown"
-- rather than "shown wrong" — and on a shop that sells cash on delivery, a phone number that does
-- not answer is worse than none.
--
-- Guarded on the old address, so it fires exactly once and never overwrites a real number typed
-- into `/admin/settings` afterwards.
-- ---------------------------------------------------------------------------------------------

update settings
set value = jsonb_build_object(
      'name', 'BIOCODE',
      'email', 'info@shtrejt.com',
      'phone', '',
      'address', 'Prishtinë, Kosovë',
      'instagram', '',
      'tiktok', '',
      'facebook', ''),
    updated_at = now()
where key = 'store' and value->>'email' = 'info@biocode.com';
