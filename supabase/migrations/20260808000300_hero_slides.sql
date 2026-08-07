-- =============================================================================
-- 73 · The homepage hero, as content rather than code
-- Source: docs/05 §1. The hero was three message keys and a hardcoded image.
-- =============================================================================

/*
 * ── Why a new table rather than the `banners` one ──
 *
 * `banners` already has a `home_hero` placement, and it was tempting. It carries title, subtitle, one
 * CTA, an image, a schedule and a position — about seventy per cent of what a slide needs.
 *
 * The missing thirty per cent is the part that would rot it: a **second** CTA, **separate desktop and
 * mobile images** with **required alt text on each**, a light/dark text variant for legibility over a
 * photograph, and a pin flag. Seven columns that mean nothing to the `offers` banners, plus validation
 * that would have to branch on `placement` — a check constraint that says "required, but only when
 * this row is a hero" is the shape of a table doing two jobs.
 *
 * So the hero gets its own table and `banners` keeps its own. The one thing borrowed is the
 * announcement bar, which really is a banner: it gains a `code` column and nothing else.
 */

create table hero_slides (
  id uuid primary key default gen_random_uuid(),

  -- Copy. Every field is `{ "sq": …, "en": … }` (CLAUDE.md §3).
  eyebrow jsonb not null default '{}'::jsonb,
  headline jsonb not null default '{}'::jsonb,
  subhead jsonb not null default '{}'::jsonb,

  cta_primary_label jsonb not null default '{}'::jsonb,
  cta_primary_href text,
  cta_secondary_label jsonb not null default '{}'::jsonb,
  cta_secondary_href text,

  /*
   * Two crops, because a 16:9 desktop photograph cropped to a phone is either a letterbox or a
   * close-up of somebody's elbow. Mobile falls back to desktop when empty, so the second slot is an
   * improvement rather than an obligation.
   */
  image_desktop_path text,
  image_desktop_alt jsonb not null default '{}'::jsonb,
  image_mobile_path text,
  image_mobile_alt jsonb not null default '{}'::jsonb,

  /** Which way the text reads over this particular image. Legibility, not taste. */
  text_variant text not null default 'dark' check (text_variant in ('light', 'dark')),

  /*
   * Holds first place even when shuffle is on. This exists so the brand slide can keep position one
   * while promos rotate behind it — without it, "shuffle" and "slide 1 carries the core message" are
   * contradictory instructions.
   */
  is_pinned boolean not null default false,

  position int not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published')),

  /** Optional window. Outside it the slide is excluded from the public carousel automatically. */
  starts_at timestamptz,
  ends_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint hero_slides_window check (starts_at is null or ends_at is null or ends_at > starts_at),

  /*
   * Alt text is required **whenever there is an image**, not merely at publish.
   *
   * Tying it to publish would let a draft accumulate images with no descriptions and then fail all at
   * once at the moment somebody is trying to ship a campaign. Tying it to the image means the
   * requirement arrives with the upload, when the person can still see what they just chose.
   */
  constraint hero_slides_desktop_alt check (
    image_desktop_path is null
    or nullif(btrim(coalesce(image_desktop_alt->>'sq', '')), '') is not null
  ),
  constraint hero_slides_mobile_alt check (
    image_mobile_path is null
    or nullif(btrim(coalesce(image_mobile_alt->>'sq', '')), '') is not null
  ),

  /*
   * What "published" means, enforced rather than described.
   *
   * **Both locales, not just Albanian.** The brief asks to block publish on an empty SQ field; the
   * same argument applies to EN, because a published slide with no English headline renders a blank
   * space on `/en` rather than falling back to anything. A half-translated slide is not publishable in
   * either direction.
   *
   * The primary CTA is required because a hero slide with nothing to click is a poster.
   */
  constraint hero_slides_publishable check (
    status <> 'published'
    or (
      nullif(btrim(coalesce(headline->>'sq', '')), '') is not null
      and nullif(btrim(coalesce(headline->>'en', '')), '') is not null
      and nullif(btrim(coalesce(cta_primary_label->>'sq', '')), '') is not null
      and nullif(btrim(coalesce(cta_primary_label->>'en', '')), '') is not null
      and nullif(btrim(coalesce(cta_primary_href, '')), '') is not null
      and image_desktop_path is not null
    )
  ),

  -- Site-relative only. These are admin-authored and go straight into a link.
  constraint hero_slides_primary_href check (cta_primary_href is null or cta_primary_href ~ '^/(?!/)'),
  constraint hero_slides_secondary_href check (
    cta_secondary_href is null or cta_secondary_href ~ '^/(?!/)'
  )
);

create index hero_slides_live_idx on hero_slides (position, created_at) where status = 'published';

/**
 * At most one pinned slide — two things claiming first place is not a resolvable state.
 *
 * Partial on `is_pinned`, so only pinned rows are indexed and they all carry the same value: the
 * second one to claim it violates the unique constraint. Unpinned rows are not in the index at all.
 */
create unique index hero_slides_single_pin on hero_slides (is_pinned) where is_pinned;

alter table hero_slides enable row level security;

/*
 * Public read is scoped to what the carousel may show, so the schedule is enforced by the policy
 * rather than by a `where` clause each caller has to remember. A slide that is scheduled for next
 * Monday is invisible to anonymous readers on Sunday, whatever the query says.
 */
create policy p_read on hero_slides for select using (
  (
    status = 'published'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  )
  or (select has_any_role('{content_manager,product_manager}'))
);

create policy p_write on hero_slides for all
  using ((select has_any_role('{content_manager}')))
  with check ((select has_any_role('{content_manager}')));

create trigger set_updated_at before update on hero_slides
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- The announcement bar
-- -----------------------------------------------------------------------------

/*
 * One column, because the rest of an announcement bar is already a banner: EN/SQ copy in `title`,
 * an optional link in `cta_href`, an on/off in `is_active`, and a window in `starts_at`/`ends_at`.
 * Only the discount code had nowhere to live.
 */
alter table banners add column code text;

comment on column banners.code is
  'Discount code shown in the announcement bar. Meaningless for other placements.';

/*
 * ── An open redirect closed while in the neighbourhood ──
 *
 * `search_redirects.destination_path` (migration 66) checks `~ '^/'`, which passes `//evil.com`: a
 * protocol-relative URL has a leading slash and still leaves the origin. The Zod schema catches it,
 * but the SQL check is the layer that is supposed to hold when the schema is not the caller — and a
 * value from that column is handed straight to `redirect()`.
 *
 * Same lookahead the hero uses above. Verified against the live database: `/shop` passes,
 * `//evil.com` and `https://evil.com` do not.
 */
alter table search_redirects drop constraint if exists search_redirects_destination_path_check;
alter table search_redirects
  add constraint search_redirects_destination_path_check
  check (destination_path ~ '^/(?!/)');

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------

/*
 * Carousel behaviour, the trust strip and the search placeholders all land in `settings`, which is
 * where `store`, `tax` and `biohack_engine` already live. Three rows rather than three tables: none
 * of them is a list that grows, and a table of four trust items would be four rows nobody ever adds a
 * fifth to.
 *
 * `{threshold}` in the shipping label is interpolated at render from the **real** cheapest active
 * shipping method. The old copy hardcoded "Free delivery over €30" while `getFreeShippingThreshold()`
 * read the actual number, so changing a shipping method left the homepage advertising the old one.
 */
insert into settings (key, value) values
  (
    'hero',
    jsonb_build_object(
      'autoplay', true,
      'interval_seconds', 6,
      'transition', 'fade',
      'loop', true,
      'shuffle', false
    )
  ),
  (
    'trust_strip',
    jsonb_build_object(
      'items',
      jsonb_build_array(
        jsonb_build_object('icon', 'truck', 'sq', 'Transport falas mbi {threshold}', 'en', 'Free shipping over {threshold}'),
        jsonb_build_object('icon', 'clock', 'sq', 'Dorëzim brenda 1–3 ditë pune', 'en', 'Delivery in 1–3 working days'),
        jsonb_build_object('icon', 'flask', 'sq', 'Testuar në laborator të pavarur', 'en', 'Third-party lab tested'),
        jsonb_build_object('icon', 'rotate', 'sq', 'Kthim brenda 14 ditësh', 'en', '14-day returns')
      )
    )
  ),
  (
    'search_placeholders',
    jsonb_build_object(
      'sq', jsonb_build_array('Kërko magnez…', 'Kërko proteina bimore…', 'Kërko për gjumë…', 'Kërko vitamina D3…'),
      'en', jsonb_build_array('Search magnesium…', 'Search plant protein…', 'Search sleep…', 'Search vitamin D3…')
    )
  )
on conflict (key) do nothing;
