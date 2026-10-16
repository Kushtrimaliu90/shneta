-- =============================================================================
-- Merchant API — keys, and one entry point that runs as the merchant the key names
-- Source: docs/18-merchant-api.md
-- =============================================================================

/*
 * A third-party merchant with its own ERP wants to push stock and prices without a person pasting
 * a sheet into the portal every evening. The portal already does the right things — the bulk
 * upsert, the proposal batches, the catalogue export — so the API is a second *door* onto the same
 * functions, not a second implementation of them.
 *
 * ── The identity decision ──
 *
 * Every merchant-facing policy and trigger in this database is written in terms of
 * `current_merchant_ids()`, which until now meant "the merchants the signed-in user belongs to".
 * An API call has no signed-in user. The alternatives were:
 *
 *   · the route resolves the key and calls the RPCs with the service role — which bypasses every
 *     trigger that makes "a merchant cannot approve its own offer" true, and puts the one client
 *     that must never appear in the merchant lane into the middle of it (docs/16 §5);
 *   · mint a Supabase JWT for the key's creator — which binds the key to a person who may leave
 *     the business, and depends on the project's signing secret being available to the app;
 *   · **teach `current_merchant_ids()` a second source of identity**: a transaction-local setting
 *     that only `merchant_api_exec` below ever writes, after it has verified the key.
 *
 * The third is what this does. Everything downstream — RLS, `guard_merchant_offer_write`, the
 * price-change demotion, the batch caps — sees an API call as the merchant and nothing more. The
 * service client is not involved anywhere.
 *
 * ── Why the setting is trustworthy ──
 *
 * `set_config(..., true)` is local to the transaction, and PostgREST runs each RPC in its own, so
 * it cannot outlive the call that set it. A caller can only run it from SQL, and PostgREST exposes
 * no way to run arbitrary SQL — only the functions in the `public` schema, none of which take a
 * setting name to write. Staff, who could in principle write one through a migration, already hold
 * more than any merchant does.
 *
 * ── The key itself ──
 *
 * Generated in the app (`features/merchants/api-keys.ts`), shown to the merchant exactly once, and
 * stored here **only as a SHA-256 hex digest**. A leaked database dump therefore contains nothing
 * usable as a credential. `key_prefix` is the first characters of the token, kept so a merchant
 * can tell its keys apart on the portal and in its own configuration.
 */

-- -----------------------------------------------------------------------------
-- The table
-- -----------------------------------------------------------------------------

create table merchant_api_keys (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  /** What the merchant called it: "ERP nightly sync", "Warehouse laptop". */
  name text not null check (char_length(name) between 2 and 60),
  /** The visible head of the token — `bck_live_ab12` — for telling keys apart. Never enough to use. */
  key_prefix text not null check (char_length(key_prefix) between 8 and 16),
  /** SHA-256 of the full token, hex. The token itself is never stored. */
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  /**
   * What the key may do (docs/18 §2.1). Fixed at creation — a merchant wanting different scopes makes a
   * new key, so the list on the portal is always what each key could ever do.
   */
  scopes text[] not null default array[
    'catalogue:read', 'offers:read', 'offers:write', 'proposals:read', 'proposals:write',
    'orders:read', 'orders:write', 'webhooks:read', 'webhooks:write'
  ],
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  /** Bumped by the entry point, throttled to once a minute so a sync loop is not a write per call. */
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),

  constraint merchant_api_keys_scopes_valid check (
    cardinality(scopes) >= 1
    and scopes <@ array[
      'catalogue:read', 'offers:read', 'offers:write', 'proposals:read', 'proposals:write',
      'orders:read', 'orders:write', 'webhooks:read', 'webhooks:write'
    ]
  )
);

comment on table merchant_api_keys is
  'Bearer tokens a merchant uses against /api/v1/merchant/*. Hash only; the token is shown once. docs/18.';

create index merchant_api_keys_merchant_idx on merchant_api_keys (merchant_id, created_at desc);
create index merchant_api_keys_active_idx on merchant_api_keys (merchant_id) where revoked_at is null;

create trigger merchant_api_keys_updated_at
  before update on merchant_api_keys
  for each row execute function public.set_updated_at();

alter table merchant_api_keys enable row level security;

/*
 * A merchant reads and creates its own keys and may revoke them. Staff read across merchants;
 * only an admin writes on a merchant's behalf.
 *
 * `p_own_update` admits the row, and the trigger below decides which *columns* may move — the
 * same split as every other merchant-owned table (docs/16 §3): `with check` cannot name a column.
 */
create policy p_own_read on merchant_api_keys for select
  using (merchant_id = any (current_merchant_ids()));
create policy p_own_insert on merchant_api_keys for insert
  with check (
    merchant_id = any (current_merchant_ids())
    and created_by = (select auth.uid())
  );
create policy p_own_update on merchant_api_keys for update
  using (merchant_id = any (current_merchant_ids()))
  with check (merchant_id = any (current_merchant_ids()));
create policy p_staff_read on merchant_api_keys for select
  using ((select is_staff()));
create policy p_admin_write on merchant_api_keys for all
  using ((select is_admin())) with check ((select is_admin()));

-- -----------------------------------------------------------------------------
-- Column freeze and the cap
-- -----------------------------------------------------------------------------

/*
 * What a merchant may do to a key row: create one while approved and under the cap, and revoke
 * it. Everything else — the hash, the prefix, the name, which merchant it belongs to — is fixed
 * at creation. `last_used_at` is left writable because the entry point below bumps it while
 * running *as the merchant*, and a merchant forging its own last-used timestamp gains nothing.
 *
 * Five active keys. A merchant with an ERP, a warehouse tool and a test rig has three; the cap
 * stops a loop that creates a key per run from filling the table, not a real use.
 */
create or replace function public.guard_merchant_api_key_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status merchant_status;
  v_active int;
begin
  if is_service_role() or (select is_admin()) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select status into v_status from merchants where id = new.merchant_id;
    if v_status is distinct from 'approved' then
      raise exception 'MERCHANT_NOT_APPROVED' using errcode = '42501';
    end if;

    select count(*) into v_active
      from merchant_api_keys
     where merchant_id = new.merchant_id and revoked_at is null;
    if v_active >= 5 then
      raise exception 'API_KEY_LIMIT' using errcode = '23514';
    end if;

    if new.revoked_at is not null or new.revoked_by is not null or new.last_used_at is not null then
      raise exception 'API_KEY_FIELD_FORBIDDEN' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.merchant_id is distinct from old.merchant_id
     or new.name is distinct from old.name
     or new.key_prefix is distinct from old.key_prefix
     or new.key_hash is distinct from old.key_hash
     or new.scopes is distinct from old.scopes
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'API_KEY_FIELD_FORBIDDEN' using errcode = '42501';
  end if;

  -- Revocation is one-way. Un-revoking would be a key coming back from a list nobody re-audited.
  if old.revoked_at is not null and (
       new.revoked_at is distinct from old.revoked_at
    or new.revoked_by is distinct from old.revoked_by
  ) then
    raise exception 'API_KEY_FIELD_FORBIDDEN' using errcode = '42501';
  end if;

  return new;
end $$;

create trigger merchant_api_keys_write_guard
  before insert or update on merchant_api_keys
  for each row execute function public.guard_merchant_api_key_write();

-- -----------------------------------------------------------------------------
-- The second source of identity
-- -----------------------------------------------------------------------------

/** The merchant an API call is running as, or null outside one. Only `merchant_api_exec` sets it. */
create or replace function public.api_merchant_id() returns uuid
language sql stable set search_path = public as $$
  select nullif(current_setting('app.api_merchant_id', true), '')::uuid;
$$;

comment on function public.api_merchant_id is
  'Transaction-local merchant identity for an API call. Null unless merchant_api_exec set it. docs/18.';

/*
 * Restated to add the API path. The membership half is unchanged from migration 25; the status
 * filter stays in one place so suspension still applies to both routes at once (docs/16 §3).
 *
 * The API half is narrower than the membership half: the entry point only ever names an
 * **approved** merchant, so an API key cannot do anything a pending merchant can.
 */
create or replace function public.current_merchant_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.id), '{}'::uuid[])
  from merchants m
  where m.status in ('pending', 'approved')
    and (
      m.id in (select mu.merchant_id from merchant_users mu where mu.user_id = auth.uid())
      or m.id = public.api_merchant_id()
    );
$$;

comment on function public.current_merchant_ids is
  'Merchant ids the caller acts for: by membership, or by API key via api_merchant_id(). docs/16 §3, docs/18.';

-- -----------------------------------------------------------------------------
-- Webhooks — endpoints a merchant registers, and the deliveries queued for them
-- -----------------------------------------------------------------------------

/*
 * A merchant's system wants to know when its offer was approved or an order was routed to it,
 * without polling. The shape is the ordinary one: an HTTPS endpoint, a signing secret, a list of
 * events, and a queue of deliveries that a cron drains with retries (docs/18 §3.6).
 *
 * The **database enqueues, the app delivers.** Every event comes from a row changing state — an
 * offer approved by a reviewer, a fulfilment assigned by routing, a payout marked paid — and each
 * of those changes arrives by several paths (a server action, a cron, a reviewer's bulk decision).
 * An AFTER trigger is the one place that sees all of them; a call in each action is the one that
 * the next action forgets.
 *
 * The secret is stored in the clear, because it signs payloads at delivery time and a hash cannot
 * sign anything. It is a shared secret for *verifying our calls*, not a credential for calling us:
 * a leaked webhook secret lets somebody forge a notification to the merchant, never read or write
 * anything here. It is returned to the merchant exactly once, on creation or rotation.
 */
create table merchant_webhooks (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  url text not null check (url ~ '^https://' and char_length(url) <= 500),
  secret text not null check (secret ~ '^whsec_[A-Za-z0-9_-]{43}$'),
  events text[] not null,
  description text check (description is null or char_length(description) <= 200),
  status text not null default 'active' check (status in ('active', 'disabled')),
  /** Attempts that failed since the last success; the cron disables the endpoint past a ceiling. */
  consecutive_failures int not null default 0,
  disabled_at timestamptz,
  disabled_reason text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint merchant_webhooks_events_valid check (
    cardinality(events) >= 1
    and events <@ array[
      'ping',
      'offer.approved', 'offer.rejected', 'offer.review_required',
      'proposal.approved', 'proposal.rejected', 'proposal.needs_info', 'proposal.product_created',
      'batch.decided',
      'fulfilment.assigned', 'fulfilment.cancelled', 'fulfilment.delivered', 'fulfilment.returned',
      'payout.approved', 'payout.paid'
    ]
  )
);

comment on table merchant_webhooks is
  'HTTPS endpoints a merchant subscribes to events. Secret in the clear: it signs, it does not authenticate. docs/18 §3.6.';

create index merchant_webhooks_merchant_idx on merchant_webhooks (merchant_id, created_at desc);

create trigger merchant_webhooks_updated_at
  before update on merchant_webhooks
  for each row execute function public.set_updated_at();

create table merchant_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references merchant_webhooks(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status_code int,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

comment on table merchant_webhook_deliveries is
  'One row per (event, endpoint). Pending rows are claimed by /api/cron/webhooks with backoff. docs/18 §3.6.';

create index merchant_webhook_deliveries_due_idx
  on merchant_webhook_deliveries (next_attempt_at) where status = 'pending';
create index merchant_webhook_deliveries_webhook_idx
  on merchant_webhook_deliveries (webhook_id, created_at desc);

alter table merchant_webhooks enable row level security;
alter table merchant_webhook_deliveries enable row level security;

/*
 * A merchant manages its own endpoints — through the API today, and a portal screen could sit on the
 * same policies tomorrow. Deliveries are read-only for everyone but the service role: they are
 * written by `enqueue_merchant_webhook` (security definer) and updated by the cron.
 */
create policy p_own_read on merchant_webhooks for select
  using (merchant_id = any (current_merchant_ids()));
create policy p_own_insert on merchant_webhooks for insert
  with check (merchant_id = any (current_merchant_ids()));
create policy p_own_update on merchant_webhooks for update
  using (merchant_id = any (current_merchant_ids()))
  with check (merchant_id = any (current_merchant_ids()));
create policy p_own_delete on merchant_webhooks for delete
  using (merchant_id = any (current_merchant_ids()));
create policy p_staff_read on merchant_webhooks for select
  using ((select is_staff()));
create policy p_admin_write on merchant_webhooks for all
  using ((select is_admin())) with check ((select is_admin()));

create policy p_own_read on merchant_webhook_deliveries for select
  using (merchant_id = any (current_merchant_ids()));
create policy p_staff_read on merchant_webhook_deliveries for select
  using ((select is_staff()));

/** The merchant may edit the endpoint; the failure counters and the ownership are not its to write. */
create or replace function public.guard_merchant_webhook_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status merchant_status;
  v_count int;
begin
  if is_service_role() or (select is_admin()) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select status into v_status from merchants where id = new.merchant_id;
    if v_status is distinct from 'approved' then
      raise exception 'MERCHANT_NOT_APPROVED' using errcode = '42501';
    end if;
    select count(*) into v_count from merchant_webhooks where merchant_id = new.merchant_id;
    if v_count >= 5 then
      raise exception 'TOO_MANY_WEBHOOKS' using errcode = '23514';
    end if;
    if new.consecutive_failures <> 0 or new.disabled_at is not null or new.disabled_reason is not null then
      raise exception 'WEBHOOK_FIELD_FORBIDDEN' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.merchant_id is distinct from old.merchant_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.consecutive_failures is distinct from old.consecutive_failures
  then
    raise exception 'WEBHOOK_FIELD_FORBIDDEN' using errcode = '42501';
  end if;

  -- Re-enabling clears the reason; the counter is reset by the next successful delivery.
  if new.status = 'active' and old.status = 'disabled' then
    new.disabled_at := null;
    new.disabled_reason := null;
  end if;

  return new;
end $$;

create trigger merchant_webhooks_write_guard
  before insert or update on merchant_webhooks
  for each row execute function public.guard_merchant_webhook_write();

-- -----------------------------------------------------------------------------
-- Enqueueing — one function, called by the triggers below
-- -----------------------------------------------------------------------------

create or replace function public.enqueue_merchant_webhook(
  p_merchant_id uuid,
  p_event text,
  p_payload jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if p_merchant_id is null then
    return 0;
  end if;

  insert into merchant_webhook_deliveries (webhook_id, merchant_id, event, payload)
  select w.id, w.merchant_id, p_event, coalesce(p_payload, '{}'::jsonb)
    from merchant_webhooks w
   where w.merchant_id = p_merchant_id
     and w.status = 'active'
     and p_event = any (w.events);

  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function public.enqueue_merchant_webhook is
  'Queues one delivery per active endpoint of the merchant subscribed to the event. docs/18 §3.6.';

revoke all on function public.enqueue_merchant_webhook(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_merchant_webhook(uuid, text, jsonb) to service_role;

/*
 * The event sources. AFTER triggers, named `zz_…` so they run after every BEFORE guard on the same
 * table has had its say — a refused write never enqueues anything, because it never commits.
 *
 * Payloads carry **identifiers and status**, nothing a merchant could not already read through the
 * API. A fulfilment event names the fulfilment, not the customer; the merchant fetches the view.
 */
create or replace function public.webhook_on_offer_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_event text;
begin
  v_event := case
    when new.status = 'approved' then 'offer.approved'
    when new.status = 'rejected' then 'offer.rejected'
    when new.status = 'pending_review' and old.status = 'approved' then 'offer.review_required'
    else null
  end;
  if v_event is not null then
    perform public.enqueue_merchant_webhook(new.merchant_id, v_event, jsonb_build_object(
      'offer_id', new.id,
      'variant_id', new.variant_id,
      'merchant_sku', new.merchant_sku,
      'status', new.status,
      'rejection_note', new.rejection_note
    ));
  end if;
  return null;
end $$;

create trigger merchant_offers_zz_webhook
  after update of status on merchant_offers
  for each row when (old.status is distinct from new.status)
  execute function public.webhook_on_offer_status();

create or replace function public.webhook_on_proposal_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected', 'needs_info') then
    perform public.enqueue_merchant_webhook(new.merchant_id, 'proposal.' || new.status, jsonb_build_object(
      'proposal_id', new.id,
      'batch_id', new.batch_id,
      'status', new.status,
      'reviewer_note', new.reviewer_note,
      'product_name', new.payload->>'product_name',
      'merchant_sku', new.payload->>'merchant_sku',
      'barcode', new.payload->>'barcode'
    ));
  end if;

  if new.created_product_id is not null and old.created_product_id is null then
    perform public.enqueue_merchant_webhook(new.merchant_id, 'proposal.product_created', jsonb_build_object(
      'proposal_id', new.id,
      'batch_id', new.batch_id,
      'product_id', new.created_product_id,
      'merchant_sku', new.payload->>'merchant_sku',
      'barcode', new.payload->>'barcode'
    ));
  end if;
  return null;
end $$;

create trigger product_proposals_zz_webhook
  after update of status, created_product_id on product_proposals
  for each row execute function public.webhook_on_proposal_change();

create or replace function public.webhook_on_batch_decided() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'decided' and old.status is distinct from 'decided' then
    perform public.enqueue_merchant_webhook(new.merchant_id, 'batch.decided', jsonb_build_object(
      'batch_id', new.id,
      'row_count', new.row_count,
      'reviewer_note', new.reviewer_note,
      'approved', (select count(*) from product_proposals p where p.batch_id = new.id and p.status = 'approved'),
      'rejected', (select count(*) from product_proposals p where p.batch_id = new.id and p.status = 'rejected')
    ));
  end if;
  return null;
end $$;

create trigger proposal_batches_zz_webhook
  after update of status on proposal_batches
  for each row execute function public.webhook_on_batch_decided();

create or replace function public.webhook_on_fulfilment_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.merchant_id is not null
     and new.status in ('assigned', 'cancelled', 'delivered', 'returned')
  then
    perform public.enqueue_merchant_webhook(new.merchant_id, 'fulfilment.' || new.status::text, jsonb_build_object(
      'fulfilment_id', new.id,
      'status', new.status,
      'order_number', (select o.order_number from orders o where o.id = new.order_id),
      'items_subtotal_cents', new.items_subtotal_cents,
      'merchant_due_cents', new.merchant_due_cents,
      'cancel_reason', new.cancel_reason
    ));
  end if;
  return null;
end $$;

create trigger order_fulfilments_zz_webhook
  after insert or update of status on order_fulfilments
  for each row when (new.merchant_id is not null)
  execute function public.webhook_on_fulfilment_status();

create or replace function public.webhook_on_payout_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved', 'paid') and new.status is distinct from old.status then
    perform public.enqueue_merchant_webhook(new.merchant_id, 'payout.' || new.status::text, jsonb_build_object(
      'payout_id', new.id,
      'status', new.status
    ));
  end if;
  return null;
end $$;

create trigger merchant_payouts_zz_webhook
  after update of status on merchant_payouts
  for each row execute function public.webhook_on_payout_status();

-- -----------------------------------------------------------------------------
-- Delivery — claimed and recorded by the cron, service role only
-- -----------------------------------------------------------------------------

/*
 * `claim` takes the due rows under `skip locked`, so two overlapping cron runs never deliver the
 * same row twice, and sets the *next* attempt before handing them out — a run that dies mid-way
 * leaves rows that simply come due again. Backoff: 1 min, 5 min, 30 min, 2 h, 12 h, then failed.
 */
create or replace function public.claim_webhook_deliveries(p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rows jsonb;
begin
  if not is_service_role() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  with due as (
    select d.id
      from merchant_webhook_deliveries d
      join merchant_webhooks w on w.id = d.webhook_id
     where d.status = 'pending'
       and d.next_attempt_at <= now()
       and w.status = 'active'
     order by d.next_attempt_at
     limit greatest(1, least(p_limit, 200))
     for update of d skip locked
  ),
  claimed as (
    update merchant_webhook_deliveries d
       set attempts = d.attempts + 1,
           next_attempt_at = now() + case d.attempts + 1
             when 1 then interval '1 minute'
             when 2 then interval '5 minutes'
             when 3 then interval '30 minutes'
             when 4 then interval '2 hours'
             else interval '12 hours'
           end
      from due
     where d.id = due.id
     returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'webhook_id', c.webhook_id,
           'merchant_id', c.merchant_id,
           'event', c.event,
           'payload', c.payload,
           'attempts', c.attempts,
           'created_at', c.created_at,
           'url', w.url,
           'secret', w.secret
         )), '[]'::jsonb)
    into v_rows
    from claimed c
    join merchant_webhooks w on w.id = c.webhook_id;

  return v_rows;
end $$;

create or replace function public.record_webhook_delivery(
  p_delivery_id uuid,
  p_ok boolean,
  p_status_code int default null,
  p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_delivery merchant_webhook_deliveries%rowtype;
  v_failures int;
begin
  if not is_service_role() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_delivery from merchant_webhook_deliveries where id = p_delivery_id for update;
  if v_delivery.id is null then
    return;
  end if;

  if p_ok then
    update merchant_webhook_deliveries
       set status = 'delivered', delivered_at = now(),
           last_status_code = p_status_code, last_error = null
     where id = p_delivery_id;
    update merchant_webhooks set consecutive_failures = 0 where id = v_delivery.webhook_id;
    return;
  end if;

  update merchant_webhook_deliveries
     set status = case when attempts >= 6 then 'failed' else 'pending' end,
         last_status_code = p_status_code,
         last_error = left(p_error, 500)
   where id = p_delivery_id;

  /*
   * Twenty-five failed attempts in a row — about two days of an endpoint that is down or wrong —
   * and the endpoint is switched off rather than hammered for ever. It stays listed with the reason,
   * and the merchant re-enables it through the API or asks BioCode to.
   */
  update merchant_webhooks
     set consecutive_failures = consecutive_failures + 1
   where id = v_delivery.webhook_id
   returning consecutive_failures into v_failures;

  if v_failures >= 25 then
    update merchant_webhooks
       set status = 'disabled', disabled_at = now(), disabled_reason = 'too_many_failures'
     where id = v_delivery.webhook_id and status = 'active';
  end if;
end $$;

revoke all on function public.claim_webhook_deliveries(int) from public, anon, authenticated;
grant execute on function public.claim_webhook_deliveries(int) to service_role;
revoke all on function public.record_webhook_delivery(uuid, boolean, int, text) from public, anon, authenticated;
grant execute on function public.record_webhook_delivery(uuid, boolean, int, text) to service_role;

-- -----------------------------------------------------------------------------
-- The entry point
-- -----------------------------------------------------------------------------

/** Which scope an action needs; null for `me`, which any live key may ask. */
create or replace function public.merchant_api_scope_for(p_action text) returns text
language sql immutable as $$
  select case p_action
    when 'me' then null
    when 'catalogue' then 'catalogue:read'
    when 'offers' then 'offers:read'
    when 'offers.upsert' then 'offers:write'
    when 'proposals' then 'proposals:read'
    when 'proposals.batch' then 'proposals:read'
    when 'proposals.create' then 'proposals:write'
    when 'proposals.image_slot' then 'proposals:write'
    when 'proposals.attach_image' then 'proposals:write'
    when 'fulfilments' then 'orders:read'
    when 'fulfilment' then 'orders:read'
    when 'fulfilment.accept' then 'orders:write'
    when 'fulfilment.pack' then 'orders:write'
    when 'fulfilment.ship' then 'orders:write'
    when 'fulfilment.decline' then 'orders:write'
    when 'webhooks' then 'webhooks:read'
    when 'webhook.deliveries' then 'webhooks:read'
    when 'webhook.create' then 'webhooks:write'
    when 'webhook.update' then 'webhooks:write'
    when 'webhook.delete' then 'webhooks:write'
    when 'webhook.rotate' then 'webhooks:write'
    when 'webhook.ping' then 'webhooks:write'
    else '__unknown__'
  end;
$$;

/*
 * One function, one argument that is the credential, one that names the operation. Every action
 * the API offers goes through here, so key verification and the scope check cannot be forgotten by
 * a new endpoint, and the merchant identity is set in exactly one place.
 *
 * Returns an envelope rather than raising on a bad key: `{"ok": false, "error": "unauthorized"}`
 * for a missing, revoked or unknown key and for a merchant that is not approved — all the same
 * answer, so the response does not say which. A key without the scope gets `insufficient_scope`
 * with the scope named, because that one the merchant can fix. Operational failures inside an
 * action raise as the underlying functions do; the route maps them.
 */
create or replace function public.merchant_api_exec(
  p_key text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_key merchant_api_keys%rowtype;
  v_merchant merchants%rowtype;
  v_scope text;
  v_result jsonb;
  v_id uuid;
  v_batch proposal_batches%rowtype;
  v_images jsonb;
  v_ext text;
  v_secret text;
  v_webhook merchant_webhooks%rowtype;
  v_touched uuid;
begin
  if p_key is null or char_length(p_key) < 16 or char_length(p_key) > 128 then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_hash := encode(sha256(convert_to(p_key, 'UTF8')), 'hex');

  select k.* into v_key
    from merchant_api_keys k
   where k.key_hash = v_hash
     and k.revoked_at is null;

  if v_key.id is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select m.* into v_merchant from merchants m where m.id = v_key.merchant_id;

  if v_merchant.id is null or v_merchant.status <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_scope := public.merchant_api_scope_for(p_action);
  if v_scope = '__unknown__' then
    return jsonb_build_object('ok', false, 'error', 'unknown_action');
  end if;
  if v_scope is not null and not (v_scope = any (v_key.scopes)) then
    return jsonb_build_object('ok', false, 'error', 'insufficient_scope', 'scope', v_scope);
  end if;

  -- From here on, this transaction is the merchant. See api_merchant_id().
  perform set_config('app.api_merchant_id', v_merchant.id::text, true);

  if v_key.last_used_at is null or v_key.last_used_at < now() - interval '1 minute' then
    update merchant_api_keys set last_used_at = now() where id = v_key.id;
  end if;

  case p_action
    -- ── Identity ──────────────────────────────────────────────────────────────
    when 'me' then
      v_result := jsonb_build_object(
        'merchant', jsonb_build_object(
          'id', v_merchant.id,
          'slug', v_merchant.slug,
          'display_name', v_merchant.display_name,
          'status', v_merchant.status
        ),
        'key', jsonb_build_object(
          'name', v_key.name,
          'prefix', v_key.key_prefix,
          'scopes', to_jsonb(v_key.scopes),
          'created_at', v_key.created_at
        )
      );

    -- ── Catalogue ─────────────────────────────────────────────────────────────
    when 'catalogue' then
      /*
       * Identifiers only — the same columns and the same owner decision as the portal export
       * (docs/16 §9.2). No retail price and no BioCode stock, here or anywhere else in this API.
       */
      select coalesce(jsonb_agg(jsonb_build_object(
               'sku', c.sku,
               'barcode', c.barcode,
               'product_name', c.product_name,
               'variant_name', c.variant_name
             )), '[]'::jsonb)
        into v_result
        from public.catalogue_export() c;

    -- ── Offers ────────────────────────────────────────────────────────────────
    when 'offers' then
      /*
       * The merchant's own offers, every status. Filtered explicitly on the merchant rather than
       * leaning on RLS, because this body runs as the function's owner.
       */
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id,
               'sku', pv.sku,
               'barcode', pv.barcode,
               'merchant_sku', o.merchant_sku,
               'product_name', p.name,
               'variant_name', pv.name,
               'status', o.status,
               'stock_on_hand', o.stock_on_hand,
               'price_cents', o.price_cents,
               'handling_days', o.handling_days,
               'low_stock_threshold', o.low_stock_threshold,
               'rejection_note', o.rejection_note,
               'created_at', o.created_at,
               'updated_at', o.updated_at
             ) order by o.updated_at desc), '[]'::jsonb)
        into v_result
        from merchant_offers o
        join product_variants pv on pv.id = o.variant_id
        join products p on p.id = pv.product_id
       where o.merchant_id = v_merchant.id;

    when 'offers.upsert' then
      if jsonb_typeof(p_payload->'rows') <> 'array' then
        raise exception 'ROWS_NOT_AN_ARRAY';
      end if;
      v_result := public.merchant_bulk_upsert_offers(
        v_merchant.id,
        p_payload->'rows',
        coalesce((p_payload->>'create')::boolean, false)
      );

    -- ── Proposals ─────────────────────────────────────────────────────────────
    when 'proposals' then
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', b.id,
               'status', b.status,
               'note', b.note,
               'row_count', b.row_count,
               'reviewer_note', b.reviewer_note,
               'reviewed_at', b.reviewed_at,
               'created_at', b.created_at,
               'rows', (
                 select jsonb_build_object(
                   'pending',    count(*) filter (where pp.status = 'pending'),
                   'approved',   count(*) filter (where pp.status = 'approved'),
                   'rejected',   count(*) filter (where pp.status = 'rejected'),
                   'needs_info', count(*) filter (where pp.status = 'needs_info')
                 )
                 from product_proposals pp where pp.batch_id = b.id
               )
             ) order by b.created_at desc), '[]'::jsonb)
        into v_result
        from (
          select * from proposal_batches
           where merchant_id = v_merchant.id
           order by created_at desc
           limit 100
        ) b;

    when 'proposals.batch' then
      v_id := nullif(p_payload->>'batch_id', '')::uuid;
      select * into v_batch from proposal_batches where id = v_id and merchant_id = v_merchant.id;
      if v_batch.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      select jsonb_build_object(
               'id', v_batch.id,
               'status', v_batch.status,
               'note', v_batch.note,
               'row_count', v_batch.row_count,
               'reviewer_note', v_batch.reviewer_note,
               'reviewed_at', v_batch.reviewed_at,
               'created_at', v_batch.created_at,
               'rows', coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'id', pp.id,
                   'status', pp.status,
                   'product_name', pp.payload->>'product_name',
                   'brand_name', pp.payload->>'brand_name',
                   'variant_name', pp.payload->>'variant_name',
                   'barcode', pp.payload->>'barcode',
                   'merchant_sku', pp.payload->>'merchant_sku',
                   'image_count', jsonb_array_length(coalesce(pp.payload->'images', '[]'::jsonb)),
                   'reviewer_note', pp.reviewer_note,
                   'created_product_id', pp.created_product_id
                 ) order by pp.created_at)
                 from product_proposals pp where pp.batch_id = v_batch.id
               ), '[]'::jsonb)
             )
        into v_result;

    when 'proposals.create' then
      if jsonb_typeof(p_payload->'rows') <> 'array' then
        raise exception 'ROWS_NOT_AN_ARRAY';
      end if;
      v_result := public.merchant_bulk_create_proposals(
        v_merchant.id,
        p_payload->'rows',
        nullif(trim(coalesce(p_payload->>'note', '')), '')
      );

    /*
     * A photograph arrives in two steps (docs/18 §3.5). This first one decides whether the row may
     * take one and hands back the exact object path the route will write to — under this merchant's
     * own prefix, with a server-minted name — so the bytes land somewhere `merchant_attach_batch_images`
     * will accept and nowhere a caller chose.
     */
    when 'proposals.image_slot' then
      v_id := nullif(p_payload->>'batch_id', '')::uuid;
      v_ext := lower(coalesce(p_payload->>'ext', ''));
      if v_ext not in ('jpg', 'png', 'webp', 'avif') then
        raise exception 'BAD_IMAGE_TYPE';
      end if;
      select * into v_batch from proposal_batches where id = v_id and merchant_id = v_merchant.id;
      if v_batch.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      if v_batch.status <> 'pending' then
        raise exception 'BATCH_ALREADY_DECIDED';
      end if;
      select coalesce(payload->'images', '[]'::jsonb) into v_images
        from product_proposals
       where id = nullif(p_payload->>'proposal_id', '')::uuid
         and batch_id = v_batch.id
         and status in ('pending', 'needs_info');
      if v_images is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      if jsonb_array_length(v_images) >= 6 then
        raise exception 'TOO_MANY_IMAGES';
      end if;
      v_result := jsonb_build_object(
        'path', 'proposals/' || v_merchant.id::text || '/api-' || gen_random_uuid()::text || '.' || v_ext,
        'image_count', jsonb_array_length(v_images)
      );

    when 'proposals.attach_image' then
      v_result := public.merchant_attach_batch_images(
        nullif(p_payload->>'batch_id', '')::uuid,
        jsonb_build_array(jsonb_build_object(
          'proposal_id', p_payload->>'proposal_id',
          'path', p_payload->>'path'
        ))
      );

    -- ── Fulfilments ───────────────────────────────────────────────────────────
    when 'fulfilments' then
      v_result := public.merchant_fulfilment_list(nullif(p_payload->>'status', ''));

    when 'fulfilment' then
      v_result := public.merchant_fulfilment_view(nullif(p_payload->>'id', '')::uuid);
      if v_result is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;

    /*
     * The merchant's lane, exactly as the portal walks it (docs/16 §7): post a status and let
     * `guard_fulfilment_transition` judge it. The trigger sees no session and no service role, so
     * the merchant rules apply; the timestamps are stamped by `fulfilments_stamp_timestamps`.
     * `delivered` is absent and stays absent — the courier's word, BioCode's to record.
     */
    when 'fulfilment.accept' then
      update order_fulfilments set status = 'accepted'
       where id = nullif(p_payload->>'id', '')::uuid and merchant_id = v_merchant.id
       returning id into v_touched;
      if v_touched is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      v_result := public.merchant_fulfilment_view(v_touched);

    when 'fulfilment.pack' then
      update order_fulfilments set status = 'packed'
       where id = nullif(p_payload->>'id', '')::uuid and merchant_id = v_merchant.id
       returning id into v_touched;
      if v_touched is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      v_result := public.merchant_fulfilment_view(v_touched);

    when 'fulfilment.ship' then
      update order_fulfilments
         set status = 'shipped',
             carrier = p_payload->>'carrier',
             tracking_code = p_payload->>'tracking_code'
       where id = nullif(p_payload->>'id', '')::uuid and merchant_id = v_merchant.id
       returning id into v_touched;
      if v_touched is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      v_result := public.merchant_fulfilment_view(v_touched);

    when 'fulfilment.decline' then
      update order_fulfilments
         set status = 'cancelled', cancel_reason = p_payload->>'reason'
       where id = nullif(p_payload->>'id', '')::uuid and merchant_id = v_merchant.id
       returning id into v_touched;
      if v_touched is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      -- The route releases it back to the routing queue; see docs/18 §3.4.
      v_result := jsonb_build_object('fulfilment_id', v_touched, 'status', 'cancelled');

    -- ── Webhooks ──────────────────────────────────────────────────────────────
    when 'webhooks' then
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', w.id,
               'url', w.url,
               'events', to_jsonb(w.events),
               'description', w.description,
               'status', w.status,
               'consecutive_failures', w.consecutive_failures,
               'disabled_reason', w.disabled_reason,
               'created_at', w.created_at
             ) order by w.created_at desc), '[]'::jsonb)
        into v_result
        from merchant_webhooks w
       where w.merchant_id = v_merchant.id;

    when 'webhook.create' then
      v_secret := p_payload->>'secret';
      insert into merchant_webhooks (merchant_id, url, secret, events, description)
      values (
        v_merchant.id,
        p_payload->>'url',
        v_secret,
        array(select jsonb_array_elements_text(p_payload->'events')),
        nullif(trim(coalesce(p_payload->>'description', '')), '')
      )
      returning * into v_webhook;
      v_result := jsonb_build_object(
        'id', v_webhook.id,
        'url', v_webhook.url,
        'events', to_jsonb(v_webhook.events),
        'description', v_webhook.description,
        'status', v_webhook.status,
        'created_at', v_webhook.created_at,
        -- Once. The merchant stores it; we never show it again.
        'secret', v_secret
      );

    when 'webhook.update' then
      update merchant_webhooks
         set url = coalesce(p_payload->>'url', url),
             events = case when p_payload ? 'events'
                        then array(select jsonb_array_elements_text(p_payload->'events'))
                        else events end,
             description = case when p_payload ? 'description'
                        then nullif(trim(coalesce(p_payload->>'description', '')), '')
                        else description end,
             status = coalesce(p_payload->>'status', status)
       where id = nullif(p_payload->>'id', '')::uuid and merchant_id = v_merchant.id
       returning * into v_webhook;
      if v_webhook.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      v_result := jsonb_build_object(
        'id', v_webhook.id, 'url', v_webhook.url, 'events', to_jsonb(v_webhook.events),
        'description', v_webhook.description, 'status', v_webhook.status,
        'consecutive_failures', v_webhook.consecutive_failures
      );

    when 'webhook.delete' then
      delete from merchant_webhooks
       where id = nullif(p_payload->>'id', '')::uuid and merchant_id = v_merchant.id
       returning id into v_touched;
      if v_touched is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      v_result := jsonb_build_object('deleted', v_touched);

    when 'webhook.rotate' then
      v_secret := p_payload->>'secret';
      update merchant_webhooks set secret = v_secret
       where id = nullif(p_payload->>'id', '')::uuid and merchant_id = v_merchant.id
       returning id into v_touched;
      if v_touched is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      v_result := jsonb_build_object('id', v_touched, 'secret', v_secret);

    when 'webhook.ping' then
      select * into v_webhook from merchant_webhooks
       where id = nullif(p_payload->>'id', '')::uuid and merchant_id = v_merchant.id;
      if v_webhook.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      -- Regardless of its subscriptions: a ping is how you find out the endpoint works at all.
      insert into merchant_webhook_deliveries (webhook_id, merchant_id, event, payload)
      values (v_webhook.id, v_merchant.id, 'ping', jsonb_build_object('webhook_id', v_webhook.id))
      returning id into v_touched;
      v_result := jsonb_build_object('delivery_id', v_touched);

    when 'webhook.deliveries' then
      select * into v_webhook from merchant_webhooks
       where id = nullif(p_payload->>'id', '')::uuid and merchant_id = v_merchant.id;
      if v_webhook.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id,
               'event', d.event,
               'status', d.status,
               'attempts', d.attempts,
               'next_attempt_at', case when d.status = 'pending' then d.next_attempt_at end,
               'last_status_code', d.last_status_code,
               'last_error', d.last_error,
               'created_at', d.created_at,
               'delivered_at', d.delivered_at
             ) order by d.created_at desc), '[]'::jsonb)
        into v_result
        from (
          select * from merchant_webhook_deliveries
           where webhook_id = v_webhook.id
           order by created_at desc
           limit 50
        ) d;

    else
      return jsonb_build_object('ok', false, 'error', 'unknown_action');
  end case;

  return jsonb_build_object('ok', true, 'data', v_result);
end $$;

comment on function public.merchant_api_exec is
  'The merchant API entry point: verifies a bearer key and its scope, becomes that merchant for the '
  'transaction, and runs one named action through the same functions the portal uses. docs/18.';

/*
 * Anonymous on purpose. The route handler calls this with the anon key and no session — the
 * credential is the API key inside the argument, not the JWT. Granting `authenticated` as well
 * costs nothing and lets a signed-in integration test exercise it.
 */
revoke all on function public.merchant_api_exec(text, text, jsonb) from public;
grant execute on function public.merchant_api_exec(text, text, jsonb)
  to anon, authenticated, service_role;

revoke all on function public.api_merchant_id() from public;
grant execute on function public.api_merchant_id() to anon, authenticated, service_role;

revoke all on function public.merchant_api_scope_for(text) from public;
grant execute on function public.merchant_api_scope_for(text) to anon, authenticated, service_role;
