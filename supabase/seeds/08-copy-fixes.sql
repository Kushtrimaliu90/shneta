-- ---------------------------------------------------------------------------------------------
-- Corrections to copy that has already been seeded.
--
-- `06-static-pages.sql` is fixed too, which covers every fresh `db reset`. This file exists for
-- the database that already ran it — see docs/13 §U1: `supabase db push --include-seed` records
-- a changed file's new hash and skips executing it, so an edit alone reaches nothing that is
-- already live.
--
-- Targeted `replace()` rather than restating the whole body, so the statement is idempotent, its
-- guard is exact, and a content manager who has since rewritten the page keeps their version.
-- ---------------------------------------------------------------------------------------------

-- The English `/about` linked to `/contact`, which is the Albanian route. `sq` is unprefixed and
-- `en` lives under `/en` (docs/08 §1), so the English page was sending readers across locales.
update pages
set body = jsonb_set(
      body,
      '{en}',
      to_jsonb(replace(body->>'en', '[contact page](/contact)', '[contact page](/en/contact)'))
    ),
    updated_at = now()
where slug = 'about'
  and body->>'en' like '%[contact page](/contact)%';
