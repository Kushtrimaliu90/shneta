-- =============================================================================
-- 67 · Search analytics — the feedback loop
-- Source: the search audit, item 1.
-- =============================================================================

/*
 * ── The one item on the list that is worth more than the other eight ──
 *
 * Every ranking decision in `search_products` is currently a guess: a weight chosen because it seemed
 * sensible, never checked against a shopper. Without a log there is no way to tell a good guess from a bad
 * one, so tuning is permanent guesswork and every future change is unfalsifiable.
 *
 * This ships **before** launch rather than after, and the reason is timing rather than tidiness. The
 * queries worth the most are the first weeks' — customers telling you, in their own words, what they
 * expected to find and did not. That data is not recoverable later. A shop that launches without logging
 * spends its most informative month learning nothing.
 *
 * ── What is deliberately NOT logged ──
 *
 *   · **No identity.** No user id, no IP, no session, no cookie. The row is a query and its outcome. That
 *     keeps the table outside the subject-access and erasure machinery in docs/14 entirely — there is
 *     nothing in it to attribute to a person, so there is nothing to export or delete on request.
 *   · **No keystrokes.** The overlay fires a suggest query every 250 ms; logging those would multiply the
 *     write volume roughly fivefold and fill the table with prefixes — "v", "vi", "vit", "vita" — that
 *     look like four failed searches and were one successful one. Only a *submitted* search is logged.
 *
 * The click-through record is what makes the rest useful: a query with results and no clicks is a ranking
 * failure, and it is invisible unless you record both halves.
 */

create table search_events (
  id uuid primary key default gen_random_uuid(),
  -- What they typed, capped. Kept alongside the normalised form so an operator reading the report sees
  -- the actual words, including the capitalisation and accents that hint at how people write here.
  query text not null check (length(query) between 1 and 120),
  query_norm text not null,
  locale text not null check (locale in ('sq', 'en')),
  source text not null check (source in ('results', 'overlay', 'shop')),
  result_count int not null check (result_count >= 0),
  -- True when strict matching found nothing and the relaxed pass supplied these results (item 6).
  relaxed boolean not null default false,
  did_you_mean text,
  clicked_product_id uuid references products(id) on delete set null,
  clicked_position int check (clicked_position is null or clicked_position >= 1),
  clicked_at timestamptz,
  created_at timestamptz not null default now()
);

create index search_events_norm_idx on search_events (query_norm, created_at desc);
create index search_events_zero_idx on search_events (created_at desc) where result_count = 0;
create index search_events_created_idx on search_events (created_at desc);

alter table search_events enable row level security;

/*
 * Staff read; **nobody** writes directly. Both writers below are security definer and validate their
 * input, which is what keeps an anonymous, unauthenticated endpoint from being an arbitrary-insert
 * primitive against a table that grows forever.
 */
create policy p_read on search_events for select
  using ((select has_any_role('{product_manager,content_manager,support}')));

-- -----------------------------------------------------------------------------
-- Writers
-- -----------------------------------------------------------------------------

/**
 * Record a submitted search. Returns the event id, which the caller keeps so a later click can be
 * attributed to it.
 *
 * Returns NULL rather than raising when the query is junk. This is called from a page render: a logging
 * failure must never be able to take a search results page down with it.
 */
create or replace function public.log_search(
  p_query text,
  p_locale text,
  p_source text,
  p_result_count int,
  p_relaxed boolean default false,
  p_did_you_mean text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_norm  text;
  v_id    uuid;
begin
  if v_query = '' then return null; end if;
  v_query := left(v_query, 120);
  v_norm := public.search_normalize(v_query);
  if v_norm is null then return null; end if;

  insert into search_events (query, query_norm, locale, source, result_count, relaxed, did_you_mean)
  values (
    v_query,
    v_norm,
    case when p_locale = 'en' then 'en' else 'sq' end,
    case when p_source in ('results', 'overlay', 'shop') then p_source else 'results' end,
    greatest(0, coalesce(p_result_count, 0)),
    coalesce(p_relaxed, false),
    left(nullif(btrim(coalesce(p_did_you_mean, '')), ''), 120)
  )
  returning id into v_id;

  return v_id;
exception when others then
  -- Analytics is never worth a 500 on a page a customer is reading.
  return null;
end $$;

/**
 * Attribute a click to a logged search.
 *
 * The event id is the authorisation: it is an unguessable uuid the client received from its own
 * `log_search` call moments earlier. Two bounds keep that from being a write primitive — the row must be
 * **recent** (an hour), and the click may be recorded **once**. Together they mean the worst an attacker
 * with a stolen id can do is set a field that was going to be set anyway.
 */
create or replace function public.log_search_click(
  p_event_id uuid,
  p_product_id uuid,
  p_position int
) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_event_id is null or p_product_id is null then return; end if;

  update search_events
     set clicked_product_id = p_product_id,
         clicked_position = greatest(1, coalesce(p_position, 1)),
         clicked_at = now()
   where id = p_event_id
     and clicked_at is null
     and created_at > now() - interval '1 hour';
exception when others then
  return;
end $$;

/** Retention. Six months is long enough to see a season and short enough that the table stays small. */
create or replace function public.prune_search_events(p_days int default 180) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_count int;
begin
  delete from search_events
   where created_at < now() - make_interval(days => greatest(1, coalesce(p_days, 180)));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- Reports
-- -----------------------------------------------------------------------------

/**
 * One row per distinct query, with the two numbers that matter.
 *
 * **Zero-result rate** says the catalogue or the synonyms are missing something — the fix is a product, an
 * ingredient alias or a synonym group. **Click-through rate** says the ranking is wrong: results came
 * back and nobody wanted them, which is a worse failure than no results because it looks like success in
 * every other metric.
 *
 * `security_invoker` so the reader's RLS applies rather than the view owner's — the same rule the
 * marketplace and referral views follow.
 */
create view search_query_report with (security_invoker = true) as
select
  e.query_norm,
  mode() within group (order by e.query) as example_query,
  count(*)::int as searches,
  count(*) filter (where e.result_count = 0)::int as zero_results,
  count(*) filter (where e.relaxed)::int as relaxed_results,
  count(*) filter (where e.clicked_at is not null)::int as clicks,
  round(
    100.0 * count(*) filter (where e.clicked_at is not null) / nullif(count(*), 0), 1
  ) as click_rate_pct,
  round(avg(e.result_count)::numeric, 1) as avg_results,
  min(e.clicked_position)::int as best_click_position,
  max(e.created_at) as last_searched_at
from search_events e
group by e.query_norm;

comment on view search_query_report is
  'Per-query search performance: volume, zero-result rate, click-through. docs/09 — the search feedback loop.';

grant execute on function public.log_search(text, text, text, int, boolean, text) to anon, authenticated;
grant execute on function public.log_search_click(uuid, uuid, int) to anon, authenticated;
