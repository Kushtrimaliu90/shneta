-- =============================================================================
-- Seed 14 — the domain moves to biocode.fit
--
-- ── What this file is for ──
--
-- The brand is BIOCODE. `biocode.com` was unavailable, so `shtrejt.com` was registered to hold the
-- DNS and the Resend records, and the storefront has been served from it ever since. The brand now
-- has **biocode.fit**, so the two names finally agree.
--
-- Everything that *links* somewhere derives from `NEXT_PUBLIC_SITE_URL` — canonicals, hreflang,
-- `robots.txt`, the sitemap, auth callbacks, the links in fourteen email templates — so those move
-- when the environment variable moves, with no code change. Two display-only strings used to be
-- literals in components; they now read `NEXT_PUBLIC_SITE_URL` through `lib/site.ts`.
--
-- What is left is **content**: the contact address printed in the legal pages, the store email in
-- settings, and the BIOCODE brand's own website. None of those can be derived, because a contact
-- address is a decision rather than a consequence.
--
-- ── Why an update and not an edit of seed 06 ──
--
-- Both. Seeds 06/07 are edited too, so a fresh `supabase db reset` produces the new domain from the
-- start. This file exists because the *live* database already holds the old address in rows that were
-- seeded weeks ago, and a changed seed file is not re-run (docs/13 §U1) — the hash is updated and the
-- statements are skipped. Without this, a `db reset` and production would disagree.
--
-- ── Replacement, narrowly ──
--
-- `replace()` on the page bodies rather than a rewrite. The lesson is docs/13 §X12: an earlier seed
-- nearly published a terms page consisting of one clause because it restated `body` instead of
-- editing it. Here the body is read, one substring is swapped, and everything else is untouched — so
-- the 1,340 words per locale of legal text cannot be lost by this file even if it is wrong.
--
-- Idempotent by construction: replacing a string that is no longer present is a no-op.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The store contact address, which the footer, the contact page and every email signature read.
-- -----------------------------------------------------------------------------
update settings
   set value = jsonb_set(value, '{email}', '"info@biocode.fit"'::jsonb)
 where key = 'store'
   and value->>'email' = 'info@shtrejt.com';

-- -----------------------------------------------------------------------------
-- The legal pages: terms, privacy, shipping and returns, contact.
--
-- Fourteen occurrences across four pages and two locales — the address a customer is told to write to
-- for a complaint, a data-deletion request, a missing parcel, or a withdrawal under the 14-day right.
-- Every one of them has to reach an inbox somebody reads, which is why this is not cosmetic: a
-- privacy policy naming an address that bounces is a policy that cannot be exercised.
-- -----------------------------------------------------------------------------
update pages
   set body = jsonb_build_object(
         'sq', replace(body->>'sq', 'info@shtrejt.com', 'info@biocode.fit'),
         'en', replace(body->>'en', 'info@shtrejt.com', 'info@biocode.fit')
       )
 where body::text like '%info@shtrejt.com%';

-- -----------------------------------------------------------------------------
-- BIOCODE's own brand row, whose `website_url` renders as an outbound link on the brand page.
-- -----------------------------------------------------------------------------
update brands
   set website_url = 'https://biocode.fit'
 where slug = 'biocode'
   and website_url = 'https://www.shtrejt.com';

/*
 * A check the next reader can run rather than trust.
 *
 * `raise notice` rather than an exception: if something still holds the old domain that is worth
 * seeing in the push output, but it is not worth refusing to apply the rest of the migration over —
 * the remaining rows would then keep the old address *and* the ones above would be rolled back.
 */
do $$
declare
  v_settings int;
  v_pages int;
  v_brands int;
begin
  select count(*) into v_settings from settings where value::text like '%shtrejt.com%';
  select count(*) into v_pages from pages where body::text like '%shtrejt.com%';
  select count(*) into v_brands from brands where website_url like '%shtrejt.com%';

  if v_settings + v_pages + v_brands > 0 then
    raise notice 'seed 14: shtrejt.com still present — settings % · pages % · brands %',
      v_settings, v_pages, v_brands;
  else
    raise notice 'seed 14: no shtrejt.com left in settings, pages or brands';
  end if;
end $$;
