-- =============================================================================
-- Seed 10 — two demo merchants on overlapping SKUs (docs/16 §12 step 9)
--
-- Local and staging only, like every file in `seeds/`. Production gets real merchants who
-- apply through `/merchant/apply`.
--
-- ── Why two, and why overlapping ──
--
-- One merchant exercises nothing interesting: the buy box has no choice to make, the routing
-- screen has one candidate, and the tie-break rules are dead code. Two merchants holding the
-- **same variants at different prices** is the smallest fixture that makes every §1 rule
-- observable:
--
--   · BioCode stock beating both of them (NOW-D3-120, which the commerce seed stocks);
--   · the cheaper of two merchants winning the buy box (SOL-MAG-90);
--   · a price tie broken by merchant rating (JAM-B12-100, both at the same asking price);
--   · a routing screen with a real choice and a visible margin difference.
--
-- The last three need BioCode to be **out** of those variants, which the commerce seed is not — so
-- this file takes two of them to zero through a stock movement. See the note further down: without
-- it the buy box answers `biocode` for everything and the fixture demonstrates nothing.
--
-- Idempotent by fixed UUID plus `on conflict do update`, so `supabase db reset` produces
-- byte-identical state.
--
-- ── The addresses: `.invalid`, deliberately not `.test` ──
--
-- Both are RFC 6761 reserved and neither can receive mail, so either would stop somebody emailing a
-- demo merchant by accident. `@biocode.test` would be **wrong** here for a different reason: it is
-- the pattern `purgeFixtures` matches, so the E2E teardown deletes it — which it did, on the first
-- full run after this file landed. Two demo products dropped out of the catalogue mid-suite and a
-- listing test failed several spec files later, pointing at nothing.
--
-- The rule the collision reveals: **fixtures use the patterns the purge matches; seeds must not.**
-- =============================================================================

/*
 * ── Why this seed has to announce itself as the service role ──
 *
 * `guard_merchant_offer_write` refuses `status = 'approved'` and any `approved_at` from anyone who is
 * not staff or the service role (§3) — that is the trigger that stops a merchant approving its own
 * offer, and it is the whole reason the isolation suite passes.
 *
 * A seed file runs as `postgres`, which is neither: `is_service_role()` reads the JWT claim and
 * `has_any_role()` reads `auth.uid()`, and a psql session has neither. So the first `approved` offer
 * below raises `OFFER_STATUS_FORBIDDEN` and the whole file fails — which is the guard working, not a
 * bug in it.
 *
 * Setting the claim says out loud what this file is doing rather than working around the guard by
 * inserting drafts and updating them afterwards, which would pass the trigger while meaning the same
 * thing less clearly. It is reset at the foot of the file.
 */
select set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- -----------------------------------------------------------------------------
-- The merchants
-- -----------------------------------------------------------------------------

/*
 * Alpha is the reliable one: 12% commission, well rated, absorbs its own shipping. Beta is the
 * cheaper-but-newer one: 18% commission, unrated, BioCode covers shipping.
 *
 * The commission difference is the point of having two. It means the routing screen shows two
 * candidates whose asking prices and settlement figures rank differently — which is exactly the
 * judgement the screen exists to support, and impossible to see with one merchant or with two on
 * identical terms.
 */
insert into merchants (
  id, slug, legal_name, display_name, business_no, vat_no, iban, bank_name,
  contact_name, contact_email, contact_phone, address, status,
  commission_pct, ships_own, collects_cash, shipping_borne_by,
  rating_avg, rating_count, terms_version, terms_accepted_at, approved_at
) values
 (
  'd1000000-0000-4000-8000-000000000001',
  'alpha-supplements',
  'Alpha Supplements SH.P.K.',
  'Alpha Supplements',
  'ARBK-811234567',
  '600123456',
  'XK051000000000001111',
  'BKT',
  'Arta Krasniqi',
  'alpha@biocode.invalid',
  '+383 44 111 111',
  '{"line1":"Rr. Agim Ramadani 12","city":"Prishtinë","postal_code":"10000","country_code":"XK"}',
  'approved',
  12.00,
  true,
  false,
  'merchant',
  4.60,
  38,
  '1.0',
  now() - interval '90 days',
  now() - interval '88 days'
 ),
 (
  'd1000000-0000-4000-8000-000000000002',
  'beta-nutrition',
  'Beta Nutrition L.L.C.',
  'Beta Nutrition',
  'ARBK-812345678',
  null,
  'XK051000000000002222',
  'ProCredit',
  'Blerim Gashi',
  'beta@biocode.invalid',
  '+383 45 222 222',
  '{"line1":"Rr. Dëshmorët e Kombit 8","city":"Prizren","postal_code":"20000","country_code":"XK"}',
  'approved',
  18.00,
  true,
  false,
  'biocode',
  0.00,
  0,
  '1.0',
  now() - interval '20 days',
  now() - interval '18 days'
 )
on conflict (id) do update set
  slug = excluded.slug,
  legal_name = excluded.legal_name,
  display_name = excluded.display_name,
  business_no = excluded.business_no,
  iban = excluded.iban,
  bank_name = excluded.bank_name,
  contact_name = excluded.contact_name,
  contact_email = excluded.contact_email,
  contact_phone = excluded.contact_phone,
  address = excluded.address,
  status = excluded.status,
  commission_pct = excluded.commission_pct,
  shipping_borne_by = excluded.shipping_borne_by,
  rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count,
  terms_version = excluded.terms_version;

/*
 * A pending application as well, so the review queue is not empty on a fresh database and the
 * screen can be seen doing its job.
 *
 * No documents attached: that is the honest state of a fresh application, and it is what makes the
 * "registration certificate required" warning on the review card visible.
 */
insert into merchants (
  id, slug, legal_name, display_name, business_no, iban, bank_name,
  contact_name, contact_email, contact_phone, address, status,
  application_note, terms_version, terms_accepted_at
) values (
  'd1000000-0000-4000-8000-000000000003',
  'gamma-vitamins',
  'Gamma Vitamins SH.P.K.',
  'Gamma Vitamins',
  'ARBK-813456789',
  'XK051000000000003333',
  'Raiffeisen',
  'Drita Berisha',
  'gamma@biocode.invalid',
  '+383 49 333 333',
  '{"line1":"Rr. Nëna Terezë 44","city":"Gjakovë","postal_code":"50000","country_code":"XK"}',
  'pending',
  E'Categories: Vitamins, minerals\nExpected catalogue: 25\nImports directly: no',
  '1.0',
  now() - interval '2 days'
)
on conflict (id) do update set
  status = excluded.status,
  application_note = excluded.application_note,
  contact_email = excluded.contact_email;

-- -----------------------------------------------------------------------------
-- The offers
-- -----------------------------------------------------------------------------

/*
 * Three overlapping variants, each chosen to make one buy-box rule visible:
 *
 *   NOW-D3-120     both merchants offer it, and BioCode stocks it — so **BioCode wins** and the
 *                  offers are live but never selected. The rule that first-party is privileged by
 *                  the shape of the schema, not by a flag, is only observable when somebody has
 *                  set up exactly this.
 *   SOL-MAG-90     both offer it, Alpha cheaper — Alpha wins on price.
 *   JAM-B12-100    both offer it at the **same** asking price — Alpha wins on rating (4.60 to 0).
 *
 * `ON-GSW-900-CHOC` is Beta-only, so there is one variant where a single merchant is the sole
 * source. That is what a routing screen with no alternative looks like.
 *
 * Asking prices sit below the retail price on purpose. A demo where the merchant asks more than
 * settlement pays would show the routing screen's warning permanently, which teaches whoever is
 * looking at it to ignore the warning.
 */
insert into merchant_offers (
  id, merchant_id, variant_id, merchant_sku, price_cents, stock_on_hand,
  low_stock_threshold, handling_days, status, approved_at
) values
 -- NOW-D3-120 (retail €9.90) — BioCode stocks this, so neither offer ever wins the buy box.
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','ALPHA-D3-120',620,40,5,1,'approved',now() - interval '60 days'),
 ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000001','BETA-D3',600,25,3,2,'approved',now() - interval '15 days'),

 -- SOL-MAG-90 (retail €18.50) — Alpha is cheaper, so Alpha is in the buy box.
 ('d2000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000004','ALPHA-MAG-90',1180,18,4,1,'approved',now() - interval '55 days'),
 ('d2000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000004','BETA-MAG',1290,30,5,2,'approved',now() - interval '14 days'),

 -- JAM-B12-100 (retail €12.40) — identical asking price, so the rating breaks the tie.
 ('d2000000-0000-4000-8000-000000000005','d1000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000006','ALPHA-B12',800,22,4,1,'approved',now() - interval '50 days'),
 ('d2000000-0000-4000-8000-000000000006','d1000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000006','BETA-B12',800,14,3,2,'approved',now() - interval '12 days'),

 -- ON-GSW-900-CHOC (retail €34.90) — Beta only: a single-source variant.
 ('d2000000-0000-4000-8000-000000000007','d1000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000008','BETA-WHEY-900',2350,8,2,3,'approved',now() - interval '10 days'),

 /*
  * Two offers that are not live, so every status on the offers screen has an example: one waiting
  * for review and one paused by its merchant. Without these the status filters are all empty but
  * one, and nobody can tell whether they work.
  */
 ('d2000000-0000-4000-8000-000000000008','d1000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000003','ALPHA-C1000',980,12,3,1,'pending_review',null),
 ('d2000000-0000-4000-8000-000000000009','d1000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000005','BETA-ZN',760,0,3,2,'paused',now() - interval '9 days')
on conflict (id) do update set
  merchant_sku = excluded.merchant_sku,
  price_cents = excluded.price_cents,
  stock_on_hand = excluded.stock_on_hand,
  low_stock_threshold = excluded.low_stock_threshold,
  handling_days = excluded.handling_days,
  status = excluded.status;

-- -----------------------------------------------------------------------------
-- BioCode runs out of two things, so the merchants have something to win
-- -----------------------------------------------------------------------------

/*
 * ── Why this is here, and why it is a stock movement rather than an UPDATE ──
 *
 * The commerce seed stocks **every** variant, so on a fresh database BioCode wins the buy box for all
 * of them and not one merchant offer is ever selected. The first version of this file claimed
 * otherwise in its comments and was simply wrong — the buy box returned `biocode` for all four
 * variants, and the demo demonstrated nothing.
 *
 * Two variants are therefore taken to zero, which is a perfectly ordinary thing for a shop to be:
 * out of stock on a couple of lines, with suppliers who are not. That is the state the whole
 * marketplace exists for.
 *
 * Through `apply_stock_movement` rather than by writing `inventory_levels.on_hand` directly, because
 * the ledger invariant is that the movements sum to the level (docs/13 §A7). A bare UPDATE would leave
 * a warehouse whose history does not explain its shelf — and the admin stock screens read the history.
 */
do $
declare
  v_warehouse uuid;
  v_variant uuid;
  v_on_hand int;
begin
  select id into v_warehouse from warehouses where is_default limit 1;
  if v_warehouse is null then
    raise exception 'NO_DEFAULT_WAREHOUSE';
  end if;

  foreach v_variant in array array[
    'c0000000-0000-4000-8000-000000000004'::uuid,  -- SOL-MAG-90: Alpha wins on price
    'c0000000-0000-4000-8000-000000000006'::uuid   -- JAM-B12-100: a price tie, Alpha wins on rating
  ]
  loop
    select on_hand into v_on_hand
      from inventory_levels
     where variant_id = v_variant and warehouse_id = v_warehouse;

    -- Idempotent: a second run finds zero and writes no movement.
    if coalesce(v_on_hand, 0) > 0 then
      perform public.apply_stock_movement(
        v_variant,
        v_warehouse,
        'adjustment',
        -v_on_hand,
        null,
        null,
        null,
        null,
        'Demo seed: out of stock so a merchant offer wins the buy box'
      );
    end if;
  end loop;
end $;

-- -----------------------------------------------------------------------------
-- A proposal
-- -----------------------------------------------------------------------------

/*
 * One open proposal, so `/admin/merchants/proposals` has something in it and the reviewer's three
 * buttons have a row to act on.
 */
insert into product_proposals (id, merchant_id, payload, status) values (
  'd3000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'product_name', 'Creatine Monohydrate Micronized',
    'brand_name', 'Alpha Labs',
    'form', 'powder',
    'variant_name', '500 g',
    'barcode', '5060123456789',
    'source_url', 'https://example.com/creatine-monohydrate',
    'stock_on_hand', 24,
    'asking_price_cents', 1450,
    'note', 'Customers ask for plain micronized creatine constantly and BioCode only lists the flavoured blend. We import it directly and can hold stock.'
  ),
  'pending'
)
on conflict (id) do update set payload = excluded.payload, status = excluded.status;

-- -----------------------------------------------------------------------------
-- A settled fortnight, so the money screens are not empty
-- -----------------------------------------------------------------------------

/*
 * Ledger rows for Alpha covering a fortnight that has closed, and the payout that settled them.
 *
 * Written directly rather than by delivering seeded orders, and that is a deliberate limit of this
 * fixture: `post_fulfilment_to_ledger` needs a real delivered fulfilment, and manufacturing one in
 * SQL would mean seeding an order, its items, its payment and its fulfilment purely to make a
 * statement page non-empty. The **arithmetic** is asserted by the integration suite against the
 * real functions; this exists so the screens have something to render.
 *
 * The numbers are consistent with 12%: €48.60 of sales, €5.83 commission, €4.00 of shipping the
 * merchant bears, €38.77 net. The payout row balances it to zero, which is the invariant §8 rests
 * on and which anyone reading this seed should be able to check by adding the column up.
 */
insert into merchant_ledger (id, merchant_id, kind, amount_cents, note, created_at) values
 ('d4000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','sale',2480,'Items delivered', now() - interval '25 days'),
 ('d4000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','commission',-298,'12% of the item subtotal', now() - interval '25 days'),
 ('d4000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001','shipping',-200,'Shipping borne by the merchant', now() - interval '25 days'),
 ('d4000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000001','sale',2380,'Items delivered', now() - interval '22 days'),
 ('d4000000-0000-4000-8000-000000000005','d1000000-0000-4000-8000-000000000001','commission',-285,'12% of the item subtotal', now() - interval '22 days'),
 ('d4000000-0000-4000-8000-000000000006','d1000000-0000-4000-8000-000000000001','shipping',-200,'Shipping borne by the merchant', now() - interval '22 days'),
 ('d4000000-0000-4000-8000-000000000007','d1000000-0000-4000-8000-000000000001','payout',-3877,'Payout for the closed fortnight', now() - interval '20 days')
on conflict (id) do update set amount_cents = excluded.amount_cents, note = excluded.note;

/*
 * The statement those rows belong to, already paid — so `/merchant/payouts` shows a completed cycle
 * with a bank reference, which is the state a merchant will see most of the time.
 *
 * The period is fixed relative to `now()` rather than to a literal date, so the seed does not age
 * into showing a statement from years ago on a database somebody resets next spring.
 */
insert into merchant_payouts (
  id, merchant_id, period_start, period_end, gross_cents, commission_cents, net_cents,
  status, paid_at, reference, created_at
) values (
  'd5000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  (now() - interval '30 days')::date,
  (now() - interval '21 days')::date,
  4860,
  583,
  3877,
  'paid',
  now() - interval '19 days',
  'BKT-DEMO-0001',
  now() - interval '20 days'
)
on conflict (id) do update set
  gross_cents = excluded.gross_cents,
  commission_cents = excluded.commission_cents,
  net_cents = excluded.net_cents,
  status = excluded.status,
  reference = excluded.reference;

/*
 * A second, unpaid statement for Beta, so the admin screen has a row with a live "mark paid" form
 * and the merchant screen has a pending one. One paid and one pending is the minimum that shows
 * both states.
 */
insert into merchant_ledger (id, merchant_id, kind, amount_cents, note, created_at) values
 ('d4000000-0000-4000-8000-000000000011','d1000000-0000-4000-8000-000000000002','sale',3490,'Items delivered', now() - interval '6 days'),
 ('d4000000-0000-4000-8000-000000000012','d1000000-0000-4000-8000-000000000002','commission',-628,'18% of the item subtotal', now() - interval '6 days')
on conflict (id) do update set amount_cents = excluded.amount_cents, note = excluded.note;

-- -----------------------------------------------------------------------------
-- What this seed deliberately does not create
-- -----------------------------------------------------------------------------

/*
 *   · **No portal accounts.** `merchant_users` needs an `auth.users` row, and creating auth users
 *     from SQL means writing into a schema Supabase owns. `pnpm seed:users` is the sanctioned path
 *     and it already knows how; linking a demo merchant to a demo login belongs there.
 *
 *   · **No fulfilments.** They come from real orders through `route_order`, and inventing them in
 *     SQL would produce fulfilments whose stock was never reserved — the exact inconsistency §6 is
 *     built to prevent. Place an order against SOL-MAG-90 to see the routing screen populate.
 *
 *   · **No KYB documents.** The storage objects would have to exist in the bucket, and a seed that
 *     writes rows pointing at files nobody uploaded produces a review screen whose links 404.
 */

/*
 * Back to nothing, so a session that keeps running after this file does not carry a service-role claim
 * into whatever comes next.
 */
select set_config('request.jwt.claims', '', false);
