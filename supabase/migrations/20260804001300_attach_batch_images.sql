-- =============================================================================
-- 50 · M12 · attaching batch photographs — the one mutation a merchant may make to a pending row
-- Source: docs/16 §9.1; the bug is docs/13 §X15.
-- =============================================================================

/*
 * `attachBatchImages` updated `product_proposals.payload` through the merchant's own session and reported
 * three photographs attached. Zero rows had changed.
 *
 * `p_own_update` is `using (merchant_id = any (current_merchant_ids()) and status = 'needs_info')` — a
 * merchant may edit a proposal a reviewer sent *back*, and nothing else. That is correct and worth keeping:
 * a pending proposal must not change under the reviewer reading it. But a batch's photographs arrive
 * **after** its rows, by design (a server action's body is capped at 1 MB and three hundred phone
 * photographs are not going through it), so the one write the merchant legitimately needs is the one the
 * policy forbids.
 *
 * PostgREST answers an UPDATE that matched nothing with success and no error, so the action counted what it
 * *intended* to write and reported that. The E2E journey caught it by reading the rows back instead of
 * trusting the message.
 *
 * ── Why a function and not a wider policy ──
 *
 * A policy admitting `status = 'pending'` would let a merchant rewrite a pending proposal's name, brand and
 * price while it sits in the queue. This admits exactly one change — appending image paths — and returns
 * **what it actually wrote**, so the caller cannot report an optimistic number again.
 *
 * The path is re-checked here as well as in the action. The action's check is what produces a readable
 * error; this one is what makes the rule true for every caller, including a future one.
 */
create or replace function public.merchant_attach_batch_images(
  p_batch_id uuid,
  p_assignments jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch proposal_batches%rowtype;
  v_prefix text;
  v_entry jsonb;
  v_proposal_id uuid;
  v_path text;
  v_images jsonb;
  v_attached int := 0;
  v_rejected int := 0;
begin
  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'ASSIGNMENTS_NOT_AN_ARRAY';
  end if;
  if jsonb_array_length(p_assignments) > 600 then
    raise exception 'TOO_MANY_ASSIGNMENTS';
  end if;

  select * into v_batch from proposal_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'BATCH_NOT_FOUND';
  end if;

  if not (
    is_service_role()
    or v_batch.merchant_id = any (public.current_merchant_ids())
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  /*
   * A decided batch takes no more photographs. Promotion copies each row's images onto its draft product,
   * so one added afterwards would leave the product missing an image with nothing to say why.
   */
  if v_batch.status <> 'pending' then
    raise exception 'BATCH_ALREADY_DECIDED';
  end if;

  v_prefix := 'proposals/' || v_batch.merchant_id::text || '/';

  for v_entry in select * from jsonb_array_elements(p_assignments)
  loop
    v_proposal_id := nullif(v_entry->>'proposal_id', '')::uuid;
    v_path := trim(coalesce(v_entry->>'path', ''));

    -- Somebody else's folder, a traversal, or a nested path that is not where the uploader writes.
    if v_proposal_id is null
       or v_path = ''
       or position(v_prefix in v_path) <> 1
       or length(v_path) <= length(v_prefix)
       or position('..' in v_path) > 0
       or position('/' in substr(v_path, length(v_prefix) + 1)) > 0
    then
      v_rejected := v_rejected + 1;
      continue;
    end if;

    /*
     * The row, locked, and only if it belongs to **this** batch and is still open. A `proposal_id` from
     * another merchant's batch simply matches nothing — no error, because an error would confirm the row
     * exists.
     */
    select coalesce(payload->'images', '[]'::jsonb) into v_images
      from product_proposals
     where id = v_proposal_id
       and batch_id = p_batch_id
       and status in ('pending', 'needs_info')
     for update;

    if v_images is null then
      v_rejected := v_rejected + 1;
      continue;
    end if;

    -- Six per row, the same limit the single-proposal uploader enforces. Already there is not an error.
    if jsonb_array_length(v_images) >= 6 or v_images @> jsonb_build_array(v_path) then
      continue;
    end if;

    update product_proposals
       set payload = jsonb_set(
             coalesce(payload, '{}'::jsonb),
             '{images}',
             v_images || jsonb_build_array(v_path),
             true
           )
     where id = v_proposal_id;

    v_attached := v_attached + 1;
  end loop;

  return jsonb_build_object('attached', v_attached, 'rejected', v_rejected);
end $$;

comment on function public.merchant_attach_batch_images is
  'Appends uploaded photograph paths to the rows of a merchant''s own pending batch. docs/16 §9.1.';

revoke all on function public.merchant_attach_batch_images(uuid, jsonb) from public, anon;
grant execute on function public.merchant_attach_batch_images(uuid, jsonb) to authenticated, service_role;
