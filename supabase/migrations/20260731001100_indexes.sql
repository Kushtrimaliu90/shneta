-- =============================================================================
-- 11 · Indexes
-- Source: docs/03 §10, plus the ones the corrected RPCs and policies need.
-- =============================================================================

-- Catalog
create index products_status_idx    on products (status, is_featured, published_at desc);
create index products_brand_idx     on products (brand_id) where status = 'published';
create index products_search_idx    on products using gin (search_text);
create index products_name_trgm     on products using gin ((name->>'sq') extensions.gin_trgm_ops);
create index products_name_en_trgm  on products using gin ((name->>'en') extensions.gin_trgm_ops);
create index brands_name_trgm       on brands   using gin (name extensions.gin_trgm_ops);
create index products_tags_idx      on products using gin (dietary_tags);
create index products_deleted_idx   on products (deleted_at) where deleted_at is null;

create index variants_product_idx   on product_variants (product_id, position);
create index variants_default_idx   on product_variants (product_id) where is_default and is_active;
create index images_product_idx     on product_images (product_id, position);
create index pc_category_idx        on product_categories (category_id);
create index phg_goal_idx           on product_health_goals (goal_id);
create index pi_ingredient_idx      on product_ingredients (ingredient_id);
create index categories_parent_idx  on categories (parent_id, sort_order);
create index lab_reports_product_idx on lab_reports (product_id);

-- Commerce
create index orders_user_idx        on orders (user_id, placed_at desc);
create index orders_status_idx      on orders (status, placed_at desc);
create index orders_payment_idx     on orders (payment_status, placed_at desc);
create index orders_email_idx       on orders (email, placed_at desc);
create index orders_subscription_idx on orders (subscription_id) where subscription_id is not null;
create index order_items_order_idx  on order_items (order_id);
create index order_items_product_idx on order_items (product_id);
create index order_events_order_idx on order_events (order_id, created_at);
create index payments_order_idx     on payments (order_id);
create index shipments_order_idx    on shipments (order_id);
create index refunds_order_idx      on refunds (order_id);

create index carts_anon_idx         on carts (anon_token) where status = 'active';
create index carts_stale_idx        on carts (updated_at) where status = 'active';
create index cart_items_cart_idx    on cart_items (cart_id);

-- The checkout RPC counts redemptions per coupon and per user on every coupon apply.
create index coupon_redemptions_coupon_idx on coupon_redemptions (coupon_id);
create index coupon_redemptions_user_idx   on coupon_redemptions (coupon_id, user_id);
create index coupons_active_idx on coupons (is_active, ends_at) where not is_system;

-- Engagement and content
create index reviews_product_idx    on reviews (product_id, status, created_at desc);
create index reviews_user_idx       on reviews (user_id, created_at desc);
create index reviews_moderation_idx on reviews (status, created_at) where status = 'pending';
create index wishlist_user_idx      on wishlist_items (user_id, created_at desc);
create index articles_pub_idx       on articles (status, type, published_at desc);
create index subs_due_idx           on subscriptions (status, next_run_at);
create index subs_user_idx          on subscriptions (user_id, status);
create index subscription_items_sub_idx on subscription_items (subscription_id);

-- Inventory
create index movements_variant_idx  on stock_movements (variant_id, created_at desc);
create index movements_reference_idx on stock_movements (reference_type, reference_id);
create index inventory_low_idx      on inventory_levels (warehouse_id)
  where on_hand <= low_stock_threshold;

-- Ops
create index audit_created_idx      on audit_logs (created_at desc);
create index audit_entity_idx       on audit_logs (entity_type, entity_id, created_at desc);
create index audit_actor_idx        on audit_logs (actor_id, created_at desc);
create index email_log_order_idx    on email_log (order_id, created_at desc);
create index contact_status_idx     on contact_messages (status, created_at desc);
create index loyalty_user_idx       on loyalty_transactions (user_id, created_at desc);
create index loyalty_order_idx      on loyalty_transactions (order_id) where order_id is not null;
create index rate_limits_window_idx on rate_limits (window_start);
