-- =============================================================================
-- 12 · Storage buckets, storage policies, admin views
-- Source: docs/03 §11–§12, with the correction in docs/13 §B7.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Buckets (docs/03 §11). Size and MIME limits are enforced here as well as in the
-- upload action, so a forged client request cannot exceed them.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true,  2 * 1024 * 1024,
     array['image/webp','image/jpeg','image/png','image/avif']),
  ('brand-assets',   'brand-assets',   true,  2 * 1024 * 1024,
     array['image/webp','image/jpeg','image/png','image/svg+xml','image/avif']),
  ('content',        'content',        true,  4 * 1024 * 1024,
     array['image/webp','image/jpeg','image/png','image/avif']),
  ('avatars',        'avatars',        true,  512 * 1024,
     array['image/webp','image/jpeg','image/png']),
  -- Private. Served only through a server-generated signed URL, and only when
  -- `lab_reports.is_public` is true (docs/05 §3).
  ('lab-reports',    'lab-reports',    false, 10 * 1024 * 1024,
     array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- product-images — public read, product_manager write
create policy "product-images read"   on storage.objects for select
  using (bucket_id = 'product-images');
create policy "product-images insert" on storage.objects for insert
  with check (bucket_id = 'product-images' and (select public.has_any_role('{product_manager}')));
create policy "product-images update" on storage.objects for update
  using (bucket_id = 'product-images' and (select public.has_any_role('{product_manager}')));
create policy "product-images delete" on storage.objects for delete
  using (bucket_id = 'product-images' and (select public.has_any_role('{product_manager}')));

-- brand-assets — public read, product_manager write
create policy "brand-assets read"   on storage.objects for select
  using (bucket_id = 'brand-assets');
create policy "brand-assets insert" on storage.objects for insert
  with check (bucket_id = 'brand-assets' and (select public.has_any_role('{product_manager}')));
create policy "brand-assets update" on storage.objects for update
  using (bucket_id = 'brand-assets' and (select public.has_any_role('{product_manager}')));
create policy "brand-assets delete" on storage.objects for delete
  using (bucket_id = 'brand-assets' and (select public.has_any_role('{product_manager}')));

-- content — public read, content_manager write
create policy "content read"   on storage.objects for select
  using (bucket_id = 'content');
create policy "content insert" on storage.objects for insert
  with check (bucket_id = 'content' and (select public.has_any_role('{content_manager}')));
create policy "content update" on storage.objects for update
  using (bucket_id = 'content' and (select public.has_any_role('{content_manager}')));
create policy "content delete" on storage.objects for delete
  using (bucket_id = 'content' and (select public.has_any_role('{content_manager}')));

-- avatars — public read; a user may only write under their own uid prefix
create policy "avatars read"   on storage.objects for select
  using (bucket_id = 'avatars');
create policy "avatars insert" on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "avatars update" on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "avatars delete" on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- lab-reports — private. No public read policy at all; the app mints signed URLs.
create policy "lab-reports read"   on storage.objects for select
  using (bucket_id = 'lab-reports' and (select public.has_any_role('{compliance_manager,product_manager}')));
create policy "lab-reports insert" on storage.objects for insert
  with check (bucket_id = 'lab-reports' and (select public.has_any_role('{compliance_manager}')));
create policy "lab-reports update" on storage.objects for update
  using (bucket_id = 'lab-reports' and (select public.has_any_role('{compliance_manager}')));
create policy "lab-reports delete" on storage.objects for delete
  using (bucket_id = 'lab-reports' and (select public.has_any_role('{compliance_manager}')));

-- =============================================================================
-- Views
-- =============================================================================

/*
 * docs/13 §B7 — the storefront's controlled window onto stock.
 *
 * Deliberately a SECURITY DEFINER view (`security_invoker = off`, the PG default): it
 * reads `inventory_levels`, which is staff-only under RLS, and exposes only a bucketed
 * status. Anon can learn "in stock / low / out of stock" — everything the UI needs per
 * docs/05 §3 — and cannot learn unit counts or infer sales velocity from them.
 */
create view v_product_stock as
  select
    il.variant_id,
    case
      when sum(il.on_hand) <= 0 then 'out_of_stock'
      when sum(il.on_hand) <= max(il.low_stock_threshold) then 'low'
      else 'in_stock'
    end as stock_status,
    sum(il.on_hand) > 0 as is_available
  from inventory_levels il
  group by il.variant_id;

grant select on v_product_stock to anon, authenticated, service_role;

/** docs/06 §1 — dashboard revenue chart. security_invoker so RLS still applies. */
create view v_admin_daily_sales with (security_invoker = on) as
  select date_trunc('day', placed_at) as day,
         count(*) as orders,
         sum(total_cents) as revenue_cents
    from orders
   where status <> 'cancelled'
   group by 1
   order by 1 desc;

/** docs/06 §1 / §8 — low-stock queue. Staff-only by virtue of security_invoker. */
create view v_low_stock with (security_invoker = on) as
  select il.variant_id,
         pv.sku,
         p.id as product_id,
         p.name->>'sq' as product_name,
         il.warehouse_id,
         il.on_hand,
         il.low_stock_threshold
    from inventory_levels il
    join product_variants pv on pv.id = il.variant_id
    join products p on p.id = pv.product_id
   where il.on_hand <= il.low_stock_threshold
     and p.deleted_at is null;

/**
 * docs/09 §1 — the ledger invariant, as a query rather than an aspiration. Every row this
 * returns is a bug: `on_hand` must always equal the sum of `stock_movements`.
 * The integration suite asserts this view is empty after every scenario.
 */
create view v_stock_ledger_drift with (security_invoker = on) as
  select il.variant_id,
         il.warehouse_id,
         il.on_hand,
         coalesce(m.ledger_sum, 0) as ledger_sum,
         il.on_hand - coalesce(m.ledger_sum, 0) as drift
    from inventory_levels il
    left join (
      select variant_id, warehouse_id, sum(quantity) as ledger_sum
        from stock_movements
       group by variant_id, warehouse_id
    ) m on m.variant_id = il.variant_id and m.warehouse_id = il.warehouse_id
   where il.on_hand <> coalesce(m.ledger_sum, 0);
