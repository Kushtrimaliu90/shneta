-- 81 · The four homepage entry tiles become content
--
-- The intent band — "Shop by health goal", "Bestsellers", "Offers", "Build your BioHack Protocol" — was
-- four hardcoded entries with their copy in `messages/{sq,en}.json`. Changing a word, a destination or the
-- order meant a code change and a deploy, which is the wrong shape for the most prominent navigation on
-- the site: these four are how somebody who ignored the hero finds their way in, and which four they are
-- is a merchandising decision the owner should be able to take on a Tuesday (owner, 2026-08-11).
--
-- A settings row rather than a table, matching `trust_strip`. The band is exactly four-ish tiles of fixed
-- shape; a table would bring an id, a position column, RLS policies and a migration for every question,
-- and the admin screen would still be one form. `hero_slides` earned a table because a slide carries
-- images, a schedule and a publish state. A tile carries six strings.
--
-- Seeded from the current copy verbatim, so this migration changes nothing a visitor can see. That is the
-- point: the deploy that makes something editable should not also edit it.
insert into settings (key, value)
values (
  'intent_band',
  jsonb_build_object(
    'items',
    jsonb_build_array(
      jsonb_build_object(
        'icon', 'target',
        'href', '/goals',
        'titleSq', 'Blej sipas qëllimit',
        'titleEn', 'Shop by health goal',
        'bodySq', 'Gjumë, energji, imunitet e më shumë.',
        'bodyEn', 'Sleep, energy, immunity and more.'
      ),
      jsonb_build_object(
        'icon', 'star',
        'href', '/shop?sort=rating',
        'titleSq', 'Më të shiturat',
        'titleEn', 'Bestsellers',
        'bodySq', 'Çfarë blejnë më shumë të tjerët.',
        'bodyEn', 'What people are buying most.'
      ),
      jsonb_build_object(
        'icon', 'tag',
        'href', '/offers',
        'titleSq', 'Oferta',
        'titleEn', 'Offers',
        'bodySq', 'Pakot dhe uljet aktuale.',
        'bodyEn', 'Current bundles and reductions.'
      ),
      jsonb_build_object(
        'icon', 'sparkles',
        'href', '/biohack',
        'titleSq', 'Krijo Protokollin BioHack',
        'titleEn', 'Build your BioHack Protocol',
        'bodySq', 'Një rutinë e përshtatur me përgjigjet e tua.',
        'bodyEn', 'A routine matched to your answers.'
      )
    )
  )
)
on conflict (key) do nothing;

comment on table settings is
  'Key/value configuration read by the storefront and edited in the admin panel. Keys in use: hero, '
  'trust_strip, intent_band, search_placeholders, marketplace, loyalty, referral, shipping. docs/06.';
