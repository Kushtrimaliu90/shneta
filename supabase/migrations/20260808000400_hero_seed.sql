-- =============================================================================
-- 74 · The live hero becomes slide 1
-- Source: docs/05 §1. Migration, not seed — see below.
-- =============================================================================

/*
 * ── Why this is a migration ──
 *
 * Seeds are demo content and a production database may never run them. This is the *existing live
 * homepage*: the copy that is on biocode.fit right now, in both locales, with its photograph and both
 * of its CTAs. Losing it because the hero became data-driven would be the migration deleting the
 * content it exists to manage.
 *
 * ── Pinned, and that is the point of the flag ──
 *
 * This is the brand slide. It carries "Biologjia jote ka një kod." and the whole positioning, and the
 * brief is explicit that slide 1 must stand alone and that promos are upside. `is_pinned` is what lets
 * shuffle be switched on later without this slide ever losing first place.
 *
 * ── The image path is a public asset, not a storage object ──
 *
 * `/hero/lineup.webp` ships in `public/`. Every slide added from the admin panel will live in the
 * `content` bucket instead, and the renderer tells them apart by the leading slash — a path that
 * starts with `/` is served as-is, anything else is resolved against Supabase Storage. That keeps the
 * existing 122 kB WebP exactly where it is, still preloaded, still the LCP, with no re-upload and no
 * change to the file the measurement was taken against.
 */

insert into hero_slides (
  eyebrow, headline, subhead,
  cta_primary_label, cta_primary_href,
  cta_secondary_label, cta_secondary_href,
  image_desktop_path, image_desktop_alt,
  text_variant, is_pinned, position, status
)
select
  jsonb_build_object(
    'sq', 'Ushqyerja, e deshifruar',
    'en', 'Nutrition, decoded'
  ),
  jsonb_build_object(
    'sq', 'Biologjia jote ka një kod.',
    'en', 'Your biology has a code.'
  ),
  jsonb_build_object(
    'sq', 'Zhbllokoje potencialin tënd me suplemente të zgjedhura për atë që trupi yt kërkon vërtet — çdo përbërës i deklaruar, çdo dozë e shpjeguar, asgjë e fshehur pas një përzierjeje pronësore.',
    'en', 'Unlock your potential with supplements chosen for what your body is actually asking for — every ingredient disclosed, every dose explained, nothing hidden behind a proprietary blend.'
  ),
  jsonb_build_object('sq', 'Shiko produktet', 'en', 'Shop the range'),
  '/shop',
  -- The secondary CTA is the generator rather than the goal index: both answer "where do I start",
  -- and only one of them ends with the customer holding something (docs/05 §1).
  jsonb_build_object('sq', 'Krijo Protokollin BioHack', 'en', 'Build your BioHack Protocol'),
  '/biohack',
  '/hero/lineup.webp',
  jsonb_build_object(
    'sq', 'Gama e produkteve BIOCODE — proteinë bimore, multivitaminë ditore, përzierje jeshile dhe shaker, mbi një tavolinë druri me fruta të freskëta.',
    'en', 'The BIOCODE range — plant protein, a daily multivitamin, a greens blend and a shaker, on a wooden table with fresh fruit.'
  ),
  'dark',
  true,
  0,
  'published'
/*
 * Idempotent. A re-run on a database that already has slides must not add a second brand slide, and
 * `where not exists` is the version of that which does not depend on a fixed id — an operator who
 * deleted and recreated the slide would otherwise get a duplicate on the next deploy.
 */
where not exists (select 1 from hero_slides);
