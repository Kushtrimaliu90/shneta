import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

/**
 * Shared plumbing for the integration suite (docs/09 §1).
 *
 * Everything here talks to a real local Supabase. Fixtures are created through the
 * service client and torn down per test file, so each suite is independent of the seed
 * and of the others.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    'Integration tests need NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. ' +
      'Run `cp .env.example .env.local` and `supabase start` first.',
  );
}

const noPersist = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};

/**
 * Narrows a nullable fixture result. Non-null assertions are banned project-wide
 * (CLAUDE.md §1), and a named throw beats `!` here anyway: when a fixture insert fails
 * the test reports what was missing instead of a bare "cannot read property of null".
 */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`Fixture missing: ${what}`);
  return value;
}

/** Bypasses RLS. Used to build fixtures and to assert on state the caller cannot see. */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, noPersist);
}

/** Unauthenticated, RLS applies. */
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, noPersist);
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
}

/**
 * Creates a confirmed auth user, optionally promotes them to a staff role, and returns a
 * client carrying their JWT — so every assertion runs through the same RLS path the app
 * does.
 */
export async function createUser(role: string = 'customer'): Promise<TestUser> {
  const service = serviceClient();
  const email = `test-${randomUUID()}@shneta.test`;
  const password = `Pw-${randomUUID()}`;

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);

  if (role !== 'customer') {
    // Exercises docs/13 §A4: the service role must be able to set roles.
    const { error: roleError } = await service
      .from('profiles')
      .update({ role })
      .eq('id', data.user.id);
    if (roleError) throw new Error(`role assignment failed: ${roleError.message}`);
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, noPersist);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign-in failed: ${signInError.message}`);

  return { id: data.user.id, email, password, client };
}

export async function deleteUser(id: string): Promise<void> {
  await serviceClient().auth.admin.deleteUser(id);
}

export interface ProductFixture {
  brandId: string;
  productId: string;
  variantId: string;
  sku: string;
  priceCents: number;
  warehouseId: string;
}

/** A published product with one active default variant and stock on hand. */
export async function createProduct(options?: {
  priceCents?: number;
  stock?: number;
  status?: string;
  variantActive?: boolean;
}): Promise<ProductFixture> {
  const service = serviceClient();
  const suffix = randomUUID().slice(0, 8);
  const priceCents = options?.priceCents ?? 1990;
  const stock = options?.stock ?? 50;

  const { data: warehouse } = await service
    .from('warehouses')
    .select('id')
    .eq('is_default', true)
    .single();
  if (!warehouse) throw new Error('No default warehouse — did the seed run?');

  const { data: brand, error: brandError } = await service
    .from('brands')
    .insert({ slug: `brand-${suffix}`, name: `Test Brand ${suffix}` })
    .select('id')
    .single();
  if (brandError || !brand) throw new Error(`brand insert failed: ${brandError?.message}`);

  const { data: product, error: productError } = await service
    .from('products')
    .insert({
      slug: `product-${suffix}`,
      brand_id: brand.id,
      name: { sq: `Produkt ${suffix}`, en: `Product ${suffix}` },
      status: options?.status ?? 'published',
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (productError || !product) throw new Error(`product insert failed: ${productError?.message}`);

  const sku = `SKU-${suffix}`;
  const { data: variant, error: variantError } = await service
    .from('product_variants')
    .insert({
      product_id: product.id,
      sku,
      name: { sq: '60 kapsula', en: '60 capsules' },
      price_cents: priceCents,
      is_default: true,
      is_active: options?.variantActive ?? true,
    })
    .select('id')
    .single();
  if (variantError || !variant) throw new Error(`variant insert failed: ${variantError?.message}`);

  // docs/13 §A7 — opening stock is a `received` movement, never a bare on_hand write,
  // or the ledger invariant is broken from the first row.
  if (stock > 0) {
    const { error: stockError } = await service.rpc('apply_stock_movement', {
      p_variant_id: variant.id,
      p_warehouse_id: warehouse.id,
      p_type: 'received',
      p_quantity: stock,
      p_note: 'integration fixture opening balance',
    });
    if (stockError) throw new Error(`opening stock failed: ${stockError.message}`);
  }

  return {
    brandId: brand.id,
    productId: product.id,
    variantId: variant.id,
    sku,
    priceCents,
    warehouseId: warehouse.id,
  };
}

/** An active cart for a user (or a guest when `userId` is null) with one line. */
export async function createCart(
  userId: string | null,
  lines: { variantId: string; quantity: number }[],
): Promise<string> {
  const service = serviceClient();

  const { data: cart, error } = await service
    .from('carts')
    .insert({ user_id: userId })
    .select('id')
    .single();
  if (error || !cart) throw new Error(`cart insert failed: ${error?.message}`);

  for (const line of lines) {
    const { error: itemError } = await service
      .from('cart_items')
      .insert({ cart_id: cart.id, variant_id: line.variantId, quantity: line.quantity });
    if (itemError) throw new Error(`cart item insert failed: ${itemError.message}`);
  }

  return cart.id;
}

export async function defaultShippingMethodId(): Promise<string> {
  const { data } = await serviceClient()
    .from('shipping_methods')
    .select('id')
    .eq('is_active', true)
    .order('position')
    .limit(1)
    .single();
  if (!data) throw new Error('No active shipping method — did the seed run?');
  return data.id;
}

const ADDRESS = {
  recipient_name: 'Test Klienti',
  phone: '+38344000000',
  line1: 'Rruga B, 12',
  city: 'Prishtinë',
  country_code: 'XK',
};

export interface CheckoutArgs {
  cartId: string;
  shippingMethodId: string;
  couponCode?: string | null;
  provider?: 'cod' | 'bank_pos';
  email?: string;
}

export function checkoutParams(args: CheckoutArgs) {
  return {
    p_cart_id: args.cartId,
    p_email: args.email ?? 'klient@shneta.test',
    p_phone: '+38344000000',
    p_shipping_address: ADDRESS,
    p_billing_address: ADDRESS,
    p_shipping_method_id: args.shippingMethodId,
    p_payment_provider: args.provider ?? 'cod',
    p_coupon_code: args.couponCode ?? null,
    p_customer_note: null,
    p_locale: 'sq',
  };
}
