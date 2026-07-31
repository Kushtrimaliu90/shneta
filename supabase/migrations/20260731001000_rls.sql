-- =============================================================================
-- 10 · Row Level Security
-- Source: docs/03 §9, with the corrections in docs/13 §B2, §B3, §B4, §B7, §D7.
--
-- RLS is enabled on EVERY public table. With RLS on and no policy, access is denied —
-- several write paths are intentionally RPC- or service-only and have no policy at all.
--
-- docs/13 §D7: every predicate wraps `auth.uid()` and the role helpers as
-- `(select …)`. Postgres then hoists them into an InitPlan and evaluates them once per
-- statement instead of once per row. On `orders`, `order_items` and `reviews` that is the
-- difference between an index scan and a per-row function call.
-- =============================================================================

do $$
declare t text;
begin
  for t in
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- =============================================================================
-- Public catalog and content reads
-- =============================================================================

create policy p_read on brands for select using (
  (is_active and deleted_at is null)
  or (select has_any_role('{product_manager,content_manager,compliance_manager,support}'))
);
create policy p_read on categories for select using (
  (is_active and deleted_at is null)
  or (select has_any_role('{product_manager,content_manager}'))
);
create policy p_read on health_goals for select using (
  is_active or (select has_any_role('{content_manager,product_manager}'))
);
create policy p_read on ingredients for select using (
  is_active or (select has_any_role('{content_manager,product_manager,compliance_manager}'))
);
create policy p_read on products for select using (
  (status = 'published' and deleted_at is null)
  or (select has_any_role('{product_manager,content_manager,compliance_manager,support,warehouse_manager}'))
);
create policy p_read on product_variants for select using (
  exists (
    select 1 from products p
     where p.id = product_id and p.status = 'published' and p.deleted_at is null
  )
  or (select has_any_role('{product_manager,support,warehouse_manager,compliance_manager}'))
);

/*
 * docs/13 §B2 — cost lives here, not on `product_variants`, precisely so that this
 * staff-only policy exists at all. There is no public read.
 */
create policy p_staff_read on product_variant_costs for select using (
  (select has_any_role('{product_manager,admin}'))
);
create policy p_staff_write on product_variant_costs for all
  using ((select has_any_role('{product_manager}')))
  with check ((select has_any_role('{product_manager}')));

create policy p_read on product_images         for select using (true);
create policy p_read on product_categories     for select using (true);
create policy p_read on product_ingredients    for select using (true);
create policy p_read on product_health_goals   for select using (true);
create policy p_read on product_relations      for select using (true);
create policy p_read on certifications         for select using (true);
create policy p_read on product_certifications for select using (true);

create policy p_read on lab_reports for select using (
  is_public or (select has_any_role('{compliance_manager,product_manager}'))
);
create policy p_read on shipping_methods for select using (
  is_active or (select has_any_role('{admin}'))
);
create policy p_read on faqs for select using (
  is_active or (select has_any_role('{content_manager}'))
);
create policy p_read on pages for select using (
  status = 'published' or (select has_any_role('{content_manager}'))
);
create policy p_read on banners for select using (
  (is_active
   and (starts_at is null or starts_at <= now())
   and (ends_at is null or ends_at >= now()))
  or (select has_any_role('{content_manager}'))
);
create policy p_read on articles for select using (
  (status = 'published' and deleted_at is null)
  or (select has_any_role('{content_manager,compliance_manager}'))
);
create policy p_read on article_products     for select using (true);
create policy p_read on article_ingredients  for select using (true);
create policy p_read on article_health_goals for select using (true);

create policy p_read on reviews for select using (
  status = 'approved'
  or user_id = (select auth.uid())
  or (select has_any_role('{support,content_manager}'))
);

-- =============================================================================
-- Catalog writes (staff)
-- =============================================================================

create policy p_write on brands for all
  using ((select has_any_role('{product_manager}')))
  with check ((select has_any_role('{product_manager}')));
create policy p_write on categories for all
  using ((select has_any_role('{product_manager}')))
  with check ((select has_any_role('{product_manager}')));
create policy p_write on products for all
  using ((select has_any_role('{product_manager,compliance_manager}')))
  with check ((select has_any_role('{product_manager,compliance_manager}')));
create policy p_write on product_variants for all
  using ((select has_any_role('{product_manager}')))
  with check ((select has_any_role('{product_manager}')));
create policy p_write on product_images for all
  using ((select has_any_role('{product_manager}')))
  with check ((select has_any_role('{product_manager}')));
create policy p_write on product_categories for all
  using ((select has_any_role('{product_manager}')))
  with check ((select has_any_role('{product_manager}')));
create policy p_write on product_ingredients for all
  using ((select has_any_role('{product_manager}')))
  with check ((select has_any_role('{product_manager}')));
create policy p_write on product_health_goals for all
  using ((select has_any_role('{product_manager,content_manager}')))
  with check ((select has_any_role('{product_manager,content_manager}')));
create policy p_write on product_relations for all
  using ((select has_any_role('{product_manager}')))
  with check ((select has_any_role('{product_manager}')));
create policy p_write on certifications for all
  using ((select has_any_role('{compliance_manager}')))
  with check ((select has_any_role('{compliance_manager}')));
create policy p_write on product_certifications for all
  using ((select has_any_role('{compliance_manager}')))
  with check ((select has_any_role('{compliance_manager}')));
create policy p_write on lab_reports for all
  using ((select has_any_role('{compliance_manager}')))
  with check ((select has_any_role('{compliance_manager}')));
create policy p_write on ingredients for all
  using ((select has_any_role('{content_manager,product_manager}')))
  with check ((select has_any_role('{content_manager,product_manager}')));
create policy p_write on health_goals for all
  using ((select has_any_role('{content_manager}')))
  with check ((select has_any_role('{content_manager}')));
create policy p_write on articles for all
  using ((select has_any_role('{content_manager}')))
  with check ((select has_any_role('{content_manager}')));
create policy p_write on article_products for all
  using ((select has_any_role('{content_manager}')))
  with check ((select has_any_role('{content_manager}')));
create policy p_write on article_ingredients for all
  using ((select has_any_role('{content_manager}')))
  with check ((select has_any_role('{content_manager}')));
create policy p_write on article_health_goals for all
  using ((select has_any_role('{content_manager}')))
  with check ((select has_any_role('{content_manager}')));
create policy p_write on faqs for all
  using ((select has_any_role('{content_manager}')))
  with check ((select has_any_role('{content_manager}')));
create policy p_write on pages for all
  using ((select has_any_role('{content_manager}')))
  with check ((select has_any_role('{content_manager}')));
create policy p_write on banners for all
  using ((select has_any_role('{content_manager}')))
  with check ((select has_any_role('{content_manager}')));

-- =============================================================================
-- Identity
-- =============================================================================

create policy p_self_read on profiles for select using (
  id = (select auth.uid()) or (select has_any_role('{support}'))
);
create policy p_self_update on profiles for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
create policy p_admin_update on profiles for update
  using ((select has_any_role('{admin}')))
  with check ((select has_any_role('{admin}')));

create policy p_own on addresses for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy p_staff_read on addresses for select
  using ((select has_any_role('{support,warehouse_manager}')));

-- =============================================================================
-- Cart — authenticated owners only; guest carts are service-role via anon_token
-- =============================================================================

create policy p_own on carts for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy p_own on cart_items for all
  using (exists (select 1 from carts c where c.id = cart_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from carts c where c.id = cart_id and c.user_id = (select auth.uid())));

-- =============================================================================
-- Orders — read own or staff; all writes via the RPC plus staff status updates
-- =============================================================================

create policy p_read on orders for select using (
  user_id = (select auth.uid())
  or (select has_any_role('{support,warehouse_manager,compliance_manager}'))
);
/*
 * Column-level restrictions are impossible in RLS, so `guard_order_immutable_columns`
 * (migration 07) is what stops support rewriting money on a placed order — docs/13 §B6.
 */
create policy p_staff_update on orders for update
  using ((select has_any_role('{support,warehouse_manager}')))
  with check ((select has_any_role('{support,warehouse_manager}')));

create policy p_read on order_items for select using (
  exists (
    select 1 from orders o
     where o.id = order_id
       and (o.user_id = (select auth.uid())
            or (select has_any_role('{support,warehouse_manager}')))
  )
);

/** docs/05 §14 — the customer timeline shows only customer-visible events. */
create policy p_read on order_events for select using (
  (select has_any_role('{support,warehouse_manager}'))
  or (is_customer_visible and exists (
        select 1 from orders o where o.id = order_id and o.user_id = (select auth.uid())))
);
create policy p_staff_insert on order_events for insert
  with check ((select has_any_role('{support,warehouse_manager}')));

create policy p_read on payments for select using (
  exists (
    select 1 from orders o
     where o.id = order_id
       and (o.user_id = (select auth.uid()) or (select has_any_role('{support}')))
  )
);

create policy p_staff on refunds for all
  using ((select has_any_role('{support}')))
  with check ((select has_any_role('{support}')));

create policy p_read on shipments for select using (
  exists (
    select 1 from orders o
     where o.id = order_id
       and (o.user_id = (select auth.uid())
            or (select has_any_role('{support,warehouse_manager}')))
  )
);
create policy p_staff_write on shipments for insert
  with check ((select has_any_role('{support,warehouse_manager}')));
create policy p_staff_update on shipments for update
  using ((select has_any_role('{support,warehouse_manager}')))
  with check ((select has_any_role('{support,warehouse_manager}')));

-- =============================================================================
-- Coupons
-- =============================================================================

/*
 * docs/13 §B4 — the original was
 *   `for all using (has_any_role('{support,product_manager}')) with check (has_any_role('{admin}'))`.
 *
 * USING gates SELECT/UPDATE/DELETE while WITH CHECK only vets the *new* row, so support
 * and product managers could DELETE coupons — contradicting docs/06 §11 ("Deactivate ≠
 * delete once redeemed") and destroying the audit trail behind redemptions.
 *
 * Read and write are now separate policies. Customers never read coupons at all;
 * validation happens inside the checkout RPC so codes cannot be enumerated (docs/07 §9).
 */
create policy p_staff_read on coupons for select
  using ((select has_any_role('{support,product_manager}')));
create policy p_admin_write on coupons for all
  using ((select has_any_role('{admin}')))
  with check ((select has_any_role('{admin}')));

create policy p_staff_read on coupon_redemptions for select
  using ((select has_any_role('{support}')));

-- =============================================================================
-- Inventory
-- =============================================================================

create policy p_staff on warehouses for all
  using ((select has_any_role('{warehouse_manager}')))
  with check ((select has_any_role('{warehouse_manager}')));

/*
 * docs/13 §B7 — the spec had `using (true)` here, with a comment saying the UI should only
 * show "in stock / low". But the policy, not the UI, is the boundary: `using (true)` lets
 * anyone read exact on-hand counts for the entire catalog — a competitor's sales tracker,
 * since the delta between two reads is units sold.
 *
 * Storefront reads go through `v_product_stock` (migration 12), which exposes only a
 * bucketed status. The table itself is staff-only.
 */
create policy p_staff_read on inventory_levels for select
  using ((select has_any_role('{warehouse_manager,product_manager,support}')));
create policy p_wh_write on inventory_levels for all
  using ((select has_any_role('{warehouse_manager,product_manager}')))
  with check ((select has_any_role('{warehouse_manager,product_manager}')));

create policy p_wh_read on stock_movements for select
  using ((select has_any_role('{warehouse_manager,product_manager,support}')));
create policy p_wh_insert on stock_movements for insert
  with check ((select has_any_role('{warehouse_manager,product_manager}')));

create policy p_admin on shipping_methods for all
  using ((select has_any_role('{admin}')))
  with check ((select has_any_role('{admin}')));

-- =============================================================================
-- Engagement
-- =============================================================================

/*
 * docs/13 §B3 — the original `with check (user_id = auth.uid())` left `order_id`
 * unconstrained while the PDP renders a "verified purchase" badge whenever it is set.
 * Any authenticated user could attach an arbitrary order id and earn the badge.
 *
 * The claim is now proved: the order must belong to the author AND contain the product.
 */
create policy p_insert_own on reviews for insert with check (
  user_id = (select auth.uid())
  and (
    order_id is null
    or exists (
      select 1
        from orders o
        join order_items oi on oi.order_id = o.id
       where o.id = reviews.order_id
         and o.user_id = (select auth.uid())
         and oi.product_id = reviews.product_id
    )
  )
);
create policy p_update_own on reviews for update
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()));
create policy p_moderate on reviews for update
  using ((select has_any_role('{support,content_manager}')))
  with check ((select has_any_role('{support,content_manager}')));

create policy p_read on review_votes for select using (true);
create policy p_own on review_votes for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy p_own on wishlist_items for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy p_own on subscriptions for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy p_staff_read on subscriptions for select
  using ((select has_any_role('{support}')));
create policy p_staff_update on subscriptions for update
  using ((select has_any_role('{support}')))
  with check ((select has_any_role('{support}')));

create policy p_own on subscription_items for all
  using (exists (
    select 1 from subscriptions s
     where s.id = subscription_id and s.user_id = (select auth.uid())))
  with check (exists (
    select 1 from subscriptions s
     where s.id = subscription_id and s.user_id = (select auth.uid())));

create policy p_own_read on loyalty_transactions for select using (
  user_id = (select auth.uid()) or (select has_any_role('{support}'))
);
-- Inserts only through triggers and `redeem_loyalty_points` (both security definer).

create policy p_own_insert on quiz_submissions for insert
  with check (user_id = (select auth.uid()) or user_id is null);
create policy p_own_read on quiz_submissions for select using (
  user_id = (select auth.uid()) or (select has_any_role('{content_manager}'))
);

-- =============================================================================
-- Operations
-- =============================================================================

create policy p_staff_read on contact_messages for select
  using ((select has_any_role('{support}')));
create policy p_staff_update on contact_messages for update
  using ((select has_any_role('{support}')))
  with check ((select has_any_role('{support}')));
-- Inserts via `contact_submit` (docs/13 §B5).

create policy p_admin_read on audit_logs for select
  using ((select has_any_role('{admin}')));
-- Inserts via `log_audit` (docs/13 §B5).

create policy p_read on settings for select using (true);  -- non-secret config only
create policy p_admin_write on settings for all
  using ((select has_any_role('{admin}')))
  with check ((select has_any_role('{admin}')));

create policy p_staff_read on email_log for select
  using ((select has_any_role('{support}')));

-- =============================================================================
-- Audit helper
-- =============================================================================

/**
 * docs/10 §4 — "RLS everywhere" is asserted, not trusted. CI and the integration suite
 * both call this; any row it returns fails the build. Service role only, since the list
 * of unprotected tables is itself a map of where to attack.
 */
create or replace function public.tables_without_rls() returns setof text
language sql stable security definer set search_path = public as $$
  select tablename::text
    from pg_tables
   where schemaname = 'public' and not rowsecurity
   order by 1;
$$;

revoke all on function public.tables_without_rls() from public, anon, authenticated;
grant execute on function public.tables_without_rls() to service_role;

-- newsletter_subscribers · rate_limits · audit_logs (insert) · contact_messages (insert)
-- · loyalty_transactions (insert) · email_log (insert) · guest carts:
-- reachable only via security-definer RPCs, triggers or the service role. No policies,
-- which with RLS enabled means denied by default.
