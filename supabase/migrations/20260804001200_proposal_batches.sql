-- =============================================================================
-- 49 · M12 · proposal batches — a catalogue arrives as one thing a reviewer decides
-- Source: docs/16 §9.1.
-- =============================================================================

/*
 * A merchant onboarding two hundred products BioCode does not list has to submit two hundred proposals,
 * one form at a time, against a cap of twenty open ones. So the honest answer today is "we cannot take
 * your catalogue" — and the cap is not the problem to remove: it exists because one merchant must not be
 * able to make the review queue unusable for everybody else.
 *
 * The fix is to change **what a reviewer decides**. A batch is one object with many rows: the merchant
 * pastes a sheet, the reviewer reads a table, rejects the rows that are wrong, and approves the rest in one
 * action. Two hundred rows stop being two hundred queue items and become one.
 *
 * ── Why the cap moves rather than disappears ──
 *
 * Individual proposals keep their cap of twenty open, unchanged — that path is for one product somebody
 * thought of, and twenty waiting is already generous. Batch rows are **exempt** from it and bounded
 * differently: 200 rows per batch, 3 open batches per merchant. The queue cost of a batch is one table a
 * reviewer scrolls, not 200 cards, so the thing being limited is the thing that actually costs review time.
 *
 * ── Per-row reject, batch approve ──
 *
 * The asymmetry is deliberate. Rejecting is a judgement about one product — wrong brand, no barcode, we
 * already list it — and each rejected row needs its own reason the merchant can act on. Approving is a
 * judgement about the whole sheet: these are products we want. So `decide_proposal_batch` approves
 * everything still pending and leaves rows already rejected exactly as they are.
 */

create table proposal_batches (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  /*
   * `pending` until a reviewer has answered the batch as a whole. Rows carry their own statuses in
   * `product_proposals` — this is the queue item's state, not a summary of theirs, because a summary would
   * be a second source of truth for something already recorded per row.
   */
  status text not null default 'pending' check (status in ('pending', 'decided')),
  /** The merchant's covering note: where the stock is, why this catalogue, what the reviewer should know. */
  note text,
  /** What the merchant sent. Kept because rows can be rejected, and "200 sent, 60 taken" is the story. */
  row_count int not null default 0 check (row_count >= 0),
  reviewer_note text,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index proposal_batches_merchant_idx on proposal_batches (merchant_id, created_at desc);
create index proposal_batches_open_idx on proposal_batches (status) where status = 'pending';

alter table proposal_batches enable row level security;

create trigger proposal_batches_updated_at
  before update on proposal_batches
  for each row execute function public.set_updated_at();

/*
 * The same shape as `product_proposals` (§3): a merchant reads and creates its own, staff read everything,
 * and only the review roles write the reviewer columns. A merchant cannot update a batch at all — there is
 * nothing on it to edit that is not on a row.
 */
create policy p_own_read on proposal_batches for select
  using (merchant_id = any (current_merchant_ids()));
create policy p_own_insert on proposal_batches for insert
  with check (merchant_id = any (current_merchant_ids()) and status = 'pending');
create policy p_staff_read on proposal_batches for select
  using ((select is_staff()));
create policy p_pm_write on proposal_batches for all
  using ((select has_any_role('{product_manager,compliance_manager,admin}')))
  with check ((select has_any_role('{product_manager,compliance_manager,admin}')));

/*
 * The link from a row to its batch.
 *
 * Nullable, because a single proposal has no batch and always will not — the two paths coexist. `on delete
 * cascade` because a batch with its rows removed is not a batch, and keeping orphans would leave the
 * reviewer's "200 sent, 60 taken" arithmetic pointing at nothing.
 */
alter table product_proposals
  add column batch_id uuid references proposal_batches(id) on delete cascade;

create index product_proposals_batch_idx on product_proposals (batch_id, created_at);

comment on column product_proposals.batch_id is
  'The pasted catalogue this row arrived in, or null for a proposal submitted on its own. docs/16 §9.1.';

-- =============================================================================
-- Creating a batch
-- =============================================================================

/*
 * One call, one transaction, one report — the same reasoning as `merchant_bulk_upsert_offers`: a merchant
 * pasting 200 rows wants to know how many landed and which did not and why, and a loop of 200 round trips
 * gets slower the more useful the feature is.
 *
 * ── What it refuses, and why each one is worth a line ──
 *
 *   · no name or no brand — there is nothing to look up or verify;
 *   · no price — a proposal without an asking price cannot be judged commercially, which is most of what
 *     a reviewer is doing;
 *   · a duplicate **inside the sheet** — a merchant's export often repeats a product per variant, and
 *     approving both would create two canonical products for one thing;
 *   · something the merchant has **already proposed** and is still open — the same product arriving twice
 *     is the reviewer's time spent twice.
 *
 * The duplicate key is barcode when there is one and lower(name)+lower(brand) when there is not, because a
 * barcode identifies a product and a name identifies what somebody typed.
 */
create or replace function public.merchant_bulk_create_proposals(
  p_merchant_id uuid,
  p_rows jsonb,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_batch_id uuid;
  v_name text;
  v_brand text;
  v_barcode text;
  v_price int;
  v_stock int;
  v_key text;
  v_seen text[] := '{}';
  v_created int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if not (
    is_service_role()
    or p_merchant_id = any (public.current_merchant_ids())
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Staff are deliberately not allowed here: nobody submits a catalogue on a merchant's behalf.
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ROWS_NOT_AN_ARRAY';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'NO_ROWS';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception 'TOO_MANY_ROWS';
  end if;

  if (
    select count(*) from proposal_batches
     where merchant_id = p_merchant_id and status = 'pending'
  ) >= 3 then
    raise exception 'TOO_MANY_OPEN_BATCHES';
  end if;

  insert into proposal_batches (merchant_id, note, row_count)
  values (p_merchant_id, nullif(trim(coalesce(p_note, '')), ''), jsonb_array_length(p_rows))
  returning id into v_batch_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_name := nullif(trim(coalesce(v_row->>'product_name', '')), '');
    v_brand := nullif(trim(coalesce(v_row->>'brand_name', '')), '');
    v_barcode := nullif(trim(coalesce(v_row->>'barcode', '')), '');
    v_price := nullif(v_row->>'asking_price_cents', '')::int;
    v_stock := coalesce(nullif(v_row->>'stock_on_hand', '')::int, 0);

    if v_name is null or v_brand is null then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('name', coalesce(v_name, v_brand, '?'), 'reason', 'incomplete')
      );
      continue;
    end if;

    if v_price is null or v_price <= 0 then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('name', v_name, 'reason', 'no_price')
      );
      continue;
    end if;

    if v_stock < 0 then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('name', v_name, 'reason', 'negative_stock')
      );
      continue;
    end if;

    v_key := coalesce(lower(v_barcode), lower(v_name) || '|' || lower(v_brand));

    if v_key = any (v_seen) then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('name', v_name, 'reason', 'duplicate_in_sheet')
      );
      continue;
    end if;
    v_seen := v_seen || v_key;

    if exists (
      select 1 from product_proposals pp
       where pp.merchant_id = p_merchant_id
         and pp.status in ('pending', 'needs_info')
         and (
           (v_barcode is not null and lower(pp.payload->>'barcode') = lower(v_barcode))
           or (
             lower(pp.payload->>'product_name') = lower(v_name)
             and lower(pp.payload->>'brand_name') = lower(v_brand)
           )
         )
    ) then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('name', v_name, 'reason', 'already_proposed')
      );
      continue;
    end if;

    insert into product_proposals (merchant_id, batch_id, status, payload)
    values (
      p_merchant_id,
      v_batch_id,
      'pending',
      jsonb_strip_nulls(jsonb_build_object(
        'product_name', v_name,
        'brand_name', v_brand,
        'form', nullif(trim(coalesce(v_row->>'form', '')), ''),
        'variant_name', nullif(trim(coalesce(v_row->>'variant_name', '')), ''),
        'barcode', v_barcode,
        'merchant_sku', nullif(trim(coalesce(v_row->>'merchant_sku', '')), ''),
        'source_url', nullif(trim(coalesce(v_row->>'source_url', '')), ''),
        'stock_on_hand', v_stock,
        'asking_price_cents', v_price,
        'note', nullif(trim(coalesce(v_row->>'note', '')), ''),
        -- Empty on arrival. The images come next, keyed on the barcode or SKU above (§9.1).
        'images', '[]'::jsonb
      ))
    );

    v_created := v_created + 1;
  end loop;

  /*
   * A sheet where every row was refused leaves no batch behind.
   *
   * Otherwise a merchant fixing its spreadsheet burns one of its three open-batch slots per attempt, and
   * the reviewer's queue fills with empty tables. The row count is rewritten to what was actually taken so
   * "200 sent, 60 taken" reads off the batch rather than needing a count.
   */
  if v_created = 0 then
    delete from proposal_batches where id = v_batch_id;
    return jsonb_build_object(
      'batch_id', null,
      'created', 0,
      'skipped', v_skipped,
      'skipped_count', jsonb_array_length(v_skipped)
    );
  end if;

  update proposal_batches set row_count = v_created where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'created', v_created,
    'skipped', v_skipped,
    'skipped_count', jsonb_array_length(v_skipped)
  );
end $$;

comment on function public.merchant_bulk_create_proposals is
  'Creates one proposal batch from a pasted sheet, reporting the rows it refused. docs/16 §9.1.';

revoke all on function public.merchant_bulk_create_proposals(uuid, jsonb, text) from public, anon;
grant execute on function public.merchant_bulk_create_proposals(uuid, jsonb, text)
  to authenticated, service_role;

-- =============================================================================
-- Deciding a batch
-- =============================================================================

/*
 * Approves every row still pending, or rejects them; rows already decided one at a time are left alone.
 *
 * ── It records the decision and creates nothing ──
 *
 * Approving 200 proposals means creating 200 draft products and copying their photographs between storage
 * buckets, which is hundreds of round trips no request should hold open. So this marks the rows `approved`
 * and the promotion happens afterwards, swept by the housekeeping cron in bounded chunks
 * (`proposals_awaiting_promotion`). `created_product_id is null` on an approved row *is* the queue.
 *
 * That is also why the single-proposal path can keep promoting inline: one product, two images, one
 * reviewer waiting a second is fine.
 */
create or replace function public.decide_proposal_batch(
  p_batch_id uuid,
  p_decision text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch proposal_batches%rowtype;
  v_status text;
  v_touched int;
begin
  if not (
    is_service_role()
    or has_any_role(array['product_manager', 'admin']::user_role[])
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'BAD_DECISION';
  end if;

  select * into v_batch from proposal_batches where id = p_batch_id for update;
  if v_batch.id is null then
    raise exception 'BATCH_NOT_FOUND';
  end if;
  if v_batch.status <> 'pending' then
    raise exception 'BATCH_ALREADY_DECIDED';
  end if;

  -- A rejection with no words is one the merchant cannot act on.
  if p_decision = 'reject' and length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'NOTE_REQUIRED';
  end if;

  v_status := case p_decision when 'approve' then 'approved' else 'rejected' end;

  update product_proposals
     set status = v_status,
         reviewer_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), reviewer_note),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where batch_id = p_batch_id
     and status in ('pending', 'needs_info');

  get diagnostics v_touched = row_count;

  update proposal_batches
     set status = 'decided',
         reviewer_note = nullif(trim(coalesce(p_note, '')), ''),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_batch_id;

  return jsonb_build_object('decided', v_touched, 'status', v_status);
end $$;

comment on function public.decide_proposal_batch is
  'Approves or rejects every still-pending row of a batch, leaving per-row decisions alone. docs/16 §9.1.';

revoke all on function public.decide_proposal_batch(uuid, text, text) from public, anon;
grant execute on function public.decide_proposal_batch(uuid, text, text) to authenticated, service_role;

/*
 * Approved proposals that have no product yet — the promotion queue, oldest first.
 *
 * A view rather than a table: the queue is derivable from the two columns that already say everything
 * (`status = 'approved'` and `created_product_id is null`), and a second copy of that fact is a second
 * thing to keep in step. Draining it is idempotent because promotion sets `created_product_id`, so a row
 * leaves the queue by being done rather than by being marked.
 *
 * `security_invoker` so a merchant sees only its own rows and staff see all — the underlying policies
 * already say exactly that.
 */
create or replace view proposals_awaiting_promotion
with (security_invoker = on) as
  select
    pp.id,
    pp.merchant_id,
    pp.batch_id,
    pp.payload->>'product_name' as product_name,
    jsonb_array_length(coalesce(pp.payload->'images', '[]'::jsonb)) as image_count,
    pp.reviewed_at
  from product_proposals pp
  where pp.status = 'approved'
    and pp.created_product_id is null
  order by pp.reviewed_at nulls first, pp.created_at;

comment on view proposals_awaiting_promotion is
  'Approved proposals with no draft product yet. Drained by the housekeeping cron. docs/16 §9.1.';

grant select on proposals_awaiting_promotion to authenticated, service_role;
