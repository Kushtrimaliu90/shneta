import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { asLocalizedField } from '@/lib/i18n';
import { logger } from '@/lib/logger';
import { CART_COOKIE_NAME, MAX_CART_ITEM_QTY } from '@/lib/constants';
import { getCurrentUser } from '@/features/auth/queries';
import type { StockStatus } from '@/features/catalog/types';
import type { Cart, CartLine, ShippingMethodOption } from '@/features/cart/types';

/**
 * Cart reads (docs/07 §3).
 *
 * The cart is DB-backed, never localStorage (CLAUDE.md "Do NOT"), so a guest→login merge and
 * abandoned-cart data both work.
 *
 * Two clients are in play and the split is deliberate:
 *   · signed-in — the SSR client, so RLS (`p_own on carts`) enforces ownership.
 *   · guest — the **service client**, because a guest cart has `user_id = null` and no policy
 *     can match it. The `anon_token` in an httpOnly cookie is the credential. This is one of
 *     the six sanctioned service-role uses (docs/02 §6).
 *
 * The token is only ever read from an httpOnly cookie, never from a URL or request body, so
 * one guest cannot address another's cart by guessing.
 */

interface CartRow {
  id: string;
  user_id: string | null;
}

async function readCartToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(CART_COOKIE_NAME)?.value ?? null;
}

/**
 * Finds the caller's active cart without creating one.
 *
 * Read-only on purpose: this runs in Server Components, where cookies cannot be written, so
 * it must never need to mint a token. Creation belongs to the actions (`ensureCart`).
 */
export const findActiveCart = cache(
  async (): Promise<{ row: CartRow; client: SupabaseClient; isGuest: boolean } | null> => {
    const user = await getCurrentUser();

    if (user) {
      const supabase = await createClient();
      const { data } = await supabase
        .from('carts')
        .select('id, user_id')
        .eq('status', 'active')
        .maybeSingle();
      return data ? { row: data as CartRow, client: supabase, isGuest: false } : null;
    }

    const token = await readCartToken();
    if (!token) return null;

    const admin = createAdminClient();
    const { data } = await admin
      .from('carts')
      .select('id, user_id')
      .eq('anon_token', token)
      .eq('status', 'active')
      .maybeSingle();

    return data ? { row: data as CartRow, client: admin, isGuest: true } : null;
  },
);

interface RawCartItem {
  id: string;
  quantity: number;
  variant_id: string;
  product_variants: {
    id: string;
    sku: string;
    name: unknown;
    price_cents: number;
    compare_at_price_cents: number | null;
    is_active: boolean;
    products: {
      slug: string;
      name: unknown;
      status: string;
      deleted_at: string | null;
      product_images: { storage_path: string; position: number }[];
    } | null;
  } | null;
}

/**
 * The cart, resolved against the live catalog.
 *
 * Prices come from `product_variants` on every read, never from a stored copy: a cart is a
 * list of intentions, and the price is whatever it is when you check out. The checkout RPC
 * re-prices again from the same source, so a tampered client payload changes nothing.
 */
export const getCart = cache(async (): Promise<Cart | null> => {
  const found = await findActiveCart();
  if (!found) return null;

  const { row, client } = found;

  const { data, error } = await client
    .from('cart_items')
    .select(
      `id, quantity, variant_id,
       product_variants ( id, sku, name, price_cents, compare_at_price_cents, is_active,
         products ( slug, name, status, deleted_at, product_images ( storage_path, position ) ) )`,
    )
    .eq('cart_id', row.id)
    .order('created_at');

  if (error) {
    logger.error('getCart failed', { cause: error.message });
    return null;
  }

  const rows = (data ?? []) as unknown as RawCartItem[];

  const lines: CartLine[] = [];
  const prunedSkus: string[] = [];

  for (const item of rows) {
    const variant = item.product_variants;
    const product = variant?.products ?? null;

    // docs/07 §3.2 — prune inactive variants and unpublished products on read, and report
    // what went so the UI can say so instead of the total quietly changing.
    const purchasable =
      variant?.is_active === true && product?.status === 'published' && product.deleted_at === null;

    if (!variant || !product || !purchasable) {
      prunedSkus.push(variant?.sku ?? item.variant_id);
      continue;
    }

    lines.push({
      id: item.id,
      variantId: variant.id,
      quantity: item.quantity,
      productSlug: product.slug,
      productName: asLocalizedField(product.name),
      variantName: asLocalizedField(variant.name),
      sku: variant.sku,
      unitPriceCents: variant.price_cents,
      compareAtPriceCents: variant.compare_at_price_cents,
      imagePath:
        [...product.product_images].sort((a, b) => a.position - b.position)[0]?.storage_path ??
        null,
      // Filled in below from the bucketed stock view.
      stockStatus: 'in_stock',
      maxQuantity: MAX_CART_ITEM_QTY,
    });
  }

  // Stock status comes from the bucketed view — exact counts are staff-only (docs/13 §B7).
  if (lines.length > 0) {
    const { data: stock } = await client
      .from('v_product_stock')
      .select('variant_id, stock_status')
      .in(
        'variant_id',
        lines.map((line) => line.variantId),
      );

    const byVariant = new Map(
      ((stock ?? []) as { variant_id: string; stock_status: string }[]).map((entry) => [
        entry.variant_id,
        entry.stock_status as StockStatus,
      ]),
    );

    for (const line of lines) {
      line.stockStatus = byVariant.get(line.variantId) ?? 'out_of_stock';
    }
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);

  return {
    id: row.id,
    lines,
    prunedSkus,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents,
    freeShippingThresholdCents: await getFreeShippingThreshold(),
  };
});

/** Just the badge number, so the navbar does not pay for the whole cart. */
export const getCartItemCount = cache(async (): Promise<number> => {
  const cart = await getCart();
  return cart?.itemCount ?? 0;
});

/**
 * docs/07 §3.2 — the drawer's progress bar uses the **cheapest** active method's threshold.
 * Promising free delivery against an express method nobody picks would be a lie.
 */
export const getFreeShippingThreshold = cache(async (): Promise<number | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('shipping_methods')
    .select('free_over_cents')
    .eq('is_active', true)
    .not('free_over_cents', 'is', null)
    .order('free_over_cents')
    .limit(1)
    .maybeSingle();

  return (data as { free_over_cents: number } | null)?.free_over_cents ?? null;
});

export const listShippingMethods = cache(async (): Promise<ShippingMethodOption[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('shipping_methods')
    .select('id, name, description, price_cents, free_over_cents, min_days, max_days')
    .eq('is_active', true)
    .order('position');

  return (data ?? []).map((row) => {
    const method = row as {
      id: string;
      name: unknown;
      description: unknown;
      price_cents: number;
      free_over_cents: number | null;
      min_days: number;
      max_days: number;
    };
    return {
      id: method.id,
      name: asLocalizedField(method.name),
      description: asLocalizedField(method.description),
      priceCents: method.price_cents,
      freeOverCents: method.free_over_cents,
      minDays: method.min_days,
      maxDays: method.max_days,
    };
  });
});

/** docs/13 §13 — the VAT rate is configuration, not a constant baked into the UI. */
export const getVatRatePercent = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { data } = await supabase.from('settings').select('value').eq('key', 'tax').maybeSingle();
  const value = (data as { value: { rate?: number } } | null)?.value;
  return typeof value?.rate === 'number' ? value.rate : 18;
});

/** docs/06 §15 — `bank_pos` stays hidden until it is contracted and switched on. */
export const getEnabledPaymentProviders = cache(async (): Promise<('cod' | 'bank_pos')[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'checkout')
    .maybeSingle();

  const value = (data as { value: { cod_enabled?: boolean; bank_pos_enabled?: boolean } } | null)
    ?.value;

  const providers: ('cod' | 'bank_pos')[] = [];
  if (value?.cod_enabled !== false) providers.push('cod');
  if (value?.bank_pos_enabled === true) providers.push('bank_pos');
  return providers;
});
