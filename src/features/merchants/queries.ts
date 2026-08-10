import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { asLocalizedField, type LocalizedField } from '@/lib/i18n';

/**
 * docs/16 §5 — the reads behind `/merchant/**`.
 *
 * Every one uses the **SSR client**, so RLS is the filter and not a `where merchant_id = ?` clause
 * this module would have to remember. That is deliberate to the point of being the design: if a
 * query here forgot its scoping it would return nothing rather than somebody else's data, because
 * `current_merchant_ids()` is what the policies read (§3).
 *
 * There is no service client anywhere in this file, and there should never be one. The portal is the
 * surface a third party operates; a service-role read here would bypass the isolation the whole
 * milestone rests on.
 */

export type OfferStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'paused';
export type MerchantStatus = 'pending' | 'approved' | 'suspended' | 'rejected';

/** One jsonb field to a string, with everything that is not a string reading as absent. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export interface MyMerchant {
  id: string;
  slug: string;
  displayName: string;
  legalName: string;
  status: MerchantStatus;
  commissionPct: number;
  shippingBorneBy: 'biocode' | 'merchant' | 'customer' | null;
  shipsOwn: boolean;
  collectsCash: boolean;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  /** Narrowed from jsonb so the settings form can prefill it without touching a raw row. */
  address: { line1: string; city: string; postalCode: string };
  bankName: string | null;
  ibanLast4: string | null;
  /** How BioCode settles the balance. Cash merchants legitimately have no bank details. */
  settlementMethod: 'bank_transfer' | 'cash';
  /** The reviewer's note: a rejection reason, or what a pending application is still missing. */
  reviewerNote: string | null;
  termsVersion: string | null;
  ratingAvg: number;
  ratingCount: number;
  createdAt: string;
  approvedAt: string | null;
}

/**
 * The merchant the signed-in user acts for, or null.
 *
 * Null covers three different situations on purpose — not a merchant, no membership, or a merchant
 * whose status `current_merchant_ids()` excludes — because the portal's answer to all three is the
 * same and distinguishing them would mean telling a rejected applicant which of the three they are.
 *
 * `maybeSingle` rather than `single`: a person may in principle act for more than one merchant
 * (`merchant_users` allows it), and v1 shows the first. A merchant switcher is a §5 follow-up, and
 * ordering by `created_at` at least makes "the first" stable rather than planner-dependent.
 */
export async function getMyMerchant(): Promise<MyMerchant | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('merchants')
    .select(
      `id, slug, display_name, legal_name, status, commission_pct, shipping_borne_by,
       ships_own, collects_cash, contact_name, contact_email, contact_phone, address,
       bank_name, iban, settlement_method, rejection_note, terms_version, rating_avg, rating_count,
       created_at, approved_at`,
    )
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error('getMyMerchant failed', { cause: error.message });
    return null;
  }
  if (!data) return null;

  const row = data as {
    id: string;
    slug: string;
    display_name: string;
    legal_name: string;
    status: MerchantStatus;
    commission_pct: number;
    shipping_borne_by: MyMerchant['shippingBorneBy'];
    ships_own: boolean;
    collects_cash: boolean;
    contact_name: string;
    contact_email: string;
    contact_phone: string;
    address: Record<string, unknown> | null;
    bank_name: string | null;
    iban: string | null;
    settlement_method: string | null;
    rejection_note: string | null;
    terms_version: string | null;
    rating_avg: number;
    rating_count: number;
    created_at: string;
    approved_at: string | null;
  };

  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    legalName: row.legal_name,
    status: row.status,
    commissionPct: Number(row.commission_pct),
    shippingBorneBy: row.shipping_borne_by,
    shipsOwn: row.ships_own,
    collectsCash: row.collects_cash,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    address: {
      line1: asText(row.address?.line1),
      city: asText(row.address?.city),
      postalCode: asText(row.address?.postal_code),
    },
    bankName: row.bank_name,
    /*
     * Last four, even to the merchant's own portal. The account is theirs, so this is not about
     * secrecy from them — it is that a settings page left open on a laptop in a shop is a screen
     * anybody can read, and there is nothing on it they need the full number to verify.
     */
    ibanLast4: row.iban ? row.iban.slice(-4) : null,
    settlementMethod: row.settlement_method === 'cash' ? 'cash' : 'bank_transfer',
    reviewerNote: row.rejection_note,
    termsVersion: row.terms_version,
    ratingAvg: Number(row.rating_avg ?? 0),
    ratingCount: Number(row.rating_count ?? 0),
    createdAt: row.created_at,
    approvedAt: row.approved_at,
  };
}

export interface OfferRow {
  id: string;
  merchantId: string;
  merchantName: string;
  variantId: string;
  sku: string;
  merchantSku: string | null;
  variantName: LocalizedField;
  productId: string;
  productSlug: string;
  productName: LocalizedField;
  productPublished: boolean;
  variantActive: boolean;
  retailPriceCents: number;
  askingPriceCents: number;
  /** What settlement pays for one unit at the retail price, less commission and shipping. */
  merchantDueCents: number;
  commissionPct: number;
  stockOnHand: number;
  lowStockThreshold: number;
  handlingDays: number;
  status: OfferStatus;
  rejectionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OfferDetailRaw {
  id: string;
  merchant_id: string;
  merchant_name: string;
  variant_id: string;
  sku: string;
  merchant_sku: string | null;
  variant_name: unknown;
  product_id: string;
  product_slug: string;
  product_name: unknown;
  product_status: string;
  variant_active: boolean;
  retail_price_cents: number;
  asking_price_cents: number;
  merchant_due_cents: number | null;
  commission_pct: number;
  stock_on_hand: number;
  low_stock_threshold: number;
  handling_days: number;
  status: OfferStatus;
  rejection_note: string | null;
  created_at: string;
  updated_at: string;
}

const OFFER_COLUMNS = `id, merchant_id, merchant_name, variant_id, sku, merchant_sku, variant_name,
  product_id, product_slug, product_name, product_status, variant_active,
  retail_price_cents, asking_price_cents, merchant_due_cents, commission_pct,
  stock_on_hand, low_stock_threshold, handling_days, status, rejection_note,
  created_at, updated_at`;

function toOfferRow(row: OfferDetailRaw): OfferRow {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    variantId: row.variant_id,
    sku: row.sku,
    merchantSku: row.merchant_sku,
    variantName: asLocalizedField(row.variant_name),
    productId: row.product_id,
    productSlug: row.product_slug,
    productName: asLocalizedField(row.product_name),
    productPublished: row.product_status === 'published',
    variantActive: row.variant_active,
    retailPriceCents: row.retail_price_cents,
    askingPriceCents: row.asking_price_cents,
    merchantDueCents: row.merchant_due_cents ?? 0,
    commissionPct: Number(row.commission_pct),
    stockOnHand: row.stock_on_hand,
    lowStockThreshold: row.low_stock_threshold,
    handlingDays: row.handling_days,
    status: row.status,
    rejectionNote: row.rejection_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The offers this merchant may see — which, under RLS, is exactly its own.
 *
 * Read through `v_merchant_offer_detail` rather than `merchant_offers` so the portal and the admin
 * review queue see the same numbers, including what settlement would pay. Two queries computing
 * that separately is how a merchant's screen and a reviewer's screen come to disagree about the same
 * offer.
 */
export async function listMyOffers(status?: OfferStatus): Promise<OfferRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from('v_merchant_offer_detail')
    .select(OFFER_COLUMNS)
    .order('updated_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    logger.error('listMyOffers failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as unknown as OfferDetailRaw[]).map(toOfferRow);
}

export async function getMyOffer(id: string): Promise<OfferRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_merchant_offer_detail')
    .select(OFFER_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error('getMyOffer failed', { cause: error.message });
    return null;
  }
  return data ? toOfferRow(data as unknown as OfferDetailRaw) : null;
}

export interface OfferCounts {
  draft: number;
  pending_review: number;
  approved: number;
  rejected: number;
  paused: number;
  /** Approved offers at or below their own low-stock threshold — the number worth acting on. */
  lowStock: number;
  /** Approved offers that have run out. They are invisible on the storefront until restocked. */
  outOfStock: number;
}

export async function myOfferCounts(): Promise<OfferCounts> {
  const supabase = await createClient();
  const counts: OfferCounts = {
    draft: 0,
    pending_review: 0,
    approved: 0,
    rejected: 0,
    paused: 0,
    lowStock: 0,
    outOfStock: 0,
  };

  const { data, error } = await supabase
    .from('merchant_offers')
    .select('status, stock_on_hand, low_stock_threshold');

  if (error) {
    logger.error('myOfferCounts failed', { cause: error.message });
    return counts;
  }

  for (const row of (data ?? []) as {
    status: OfferStatus;
    stock_on_hand: number;
    low_stock_threshold: number;
  }[]) {
    counts[row.status] += 1;
    if (row.status !== 'approved') continue;
    if (row.stock_on_hand <= 0) counts.outOfStock += 1;
    else if (row.stock_on_hand <= row.low_stock_threshold) counts.lowStock += 1;
  }

  return counts;
}

/**
 * The document kinds the table's check constraint allows.
 *
 * A union rather than `string`, because the portal renders each one through a message key — and
 * `t(\`kinds.\${kind}\`)` only typechecks when the compiler can see the finite set. An unrecognised
 * value from the database reads as `other`, which is what a kind nobody has a label for is.
 */
export const DOCUMENT_KINDS = [
  'business_registration',
  'vat_certificate',
  'id_document',
  'import_licence',
  'other',
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

function toDocumentKind(value: string): DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(value) ? (value as DocumentKind) : 'other';
}

export interface MyDocument {
  id: string;
  kind: DocumentKind;
  storagePath: string;
  uploadedAt: string;
  verified: boolean;
}

export async function listMyDocuments(): Promise<MyDocument[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('merchant_documents')
    .select('id, kind, storage_path, uploaded_at, verified')
    .order('uploaded_at', { ascending: false });

  if (error) {
    logger.error('listMyDocuments failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as {
    id: string;
    kind: string;
    storage_path: string;
    uploaded_at: string;
    verified: boolean;
  }[]).map((row) => ({
    id: row.id,
    kind: toDocumentKind(row.kind),
    storagePath: row.storage_path,
    uploadedAt: row.uploaded_at,
    verified: row.verified,
  }));
}

export interface CatalogVariantOption {
  variantId: string;
  sku: string;
  variantName: LocalizedField;
  productName: LocalizedField;
  productSlug: string;
  brandName: string;
  /**
   * BioCode's shelf price — **server-only**, and deliberately not part of what reaches the browser.
   *
   * The page needs it to work out what settlement pays the merchant per unit, and then sends only that
   * figure. Marked here so the next person to widen a props object has to notice: this field is the one
   * thing on the option a merchant is not shown (owner decision, 2026-08-05).
   *
   * It is not a secret — every price is on the storefront — but there is a difference between a merchant
   * looking one up and the offer form printing it next to every search result while they price against it.
   */
  retailPriceCentsInternal: number;
}

/**
 * The canonical variants a merchant may offer, searched by product name or SKU.
 *
 * **Merchants never create products** (§1), so this is the entire vocabulary available to them:
 * whatever BioCode has published. A variant that is not in this list is a *proposal* (§4, step 6),
 * not something the offer form can conjure.
 *
 * Read through the SSR client on the merchant's own session, which sees published products the same
 * way an anonymous visitor does — there is no privileged catalogue read here, and a merchant cannot
 * discover a draft product through the offer picker.
 */
/**
 * How many options the picker will render before it asks the merchant to narrow the search.
 *
 * Not 20. The old cap was 20 **and** the search was broken, so a merchant who could not see a product
 * also could not find it — 72 live variants across 15 brands, of which the first page reached 6
 * brands. A limit only works when the escape hatch does.
 *
 * 200 is chosen so the whole catalogue fits today with room to grow, because a `<select>` a merchant
 * can scroll beats pagination that discards the price and stock they already typed into the form
 * below. Past 200 the count line says so and the search is the answer.
 */
export const CATALOGUE_PICKER_LIMIT = 200;

export async function searchCatalogVariants(
  term: string,
  limit = CATALOGUE_PICKER_LIMIT,
): Promise<{ options: CatalogVariantOption[]; total: number }> {
  const supabase = await createClient();
  const trimmed = term.trim();

  /*
   * Against the flattened view, not `product_variants` with an embedded product.
   *
   * The previous query OR'd `name->>sq` in the hope of matching the product title, but a bare column
   * inside a PostgREST `.or()` binds to the queried table — so it matched the *variant's* size label
   * and, because that column is jsonb, failed silently rather than erroring. Migration 78 carries the
   * measurement. One `ilike` over one prebuilt haystack replaces the whole construction, and there is
   * no operator string left to get subtly wrong.
   */
  let query = supabase
    .from('v_catalogue_variant_search')
    .select('variant_id, sku, price_cents, variant_name, product_name, product_slug, brand_name', {
      count: 'exact',
    })
    .order('sort_key')
    .order('position')
    .limit(limit);

  if (trimmed.length > 0) {
    // `%` and `_` are wildcards and `,` ends a PostgREST filter — strip rather than escape.
    const pattern = `%${trimmed.replace(/[%_,()]/g, '').toLowerCase()}%`;
    query = query.ilike('search_text', pattern);
  }

  const { data, error, count } = await query;

  if (error) {
    logger.error('searchCatalogVariants failed', { cause: error.message });
    return { options: [], total: 0 };
  }

  const options = ((data ?? []) as unknown as {
    variant_id: string;
    sku: string;
    variant_name: unknown;
    product_name: unknown;
    product_slug: string;
    brand_name: string;
    price_cents: number;
  }[]).map((row) => ({
    variantId: row.variant_id,
    sku: row.sku,
    variantName: asLocalizedField(row.variant_name),
    productName: asLocalizedField(row.product_name),
    productSlug: row.product_slug,
    brandName: row.brand_name,
    retailPriceCentsInternal: row.price_cents,
  }));

  /*
   * `count` is the number of matches, not the number returned. The page prints both so a truncated
   * list says so out loud — the old picker's whole failure was showing 20 of 72 and looking complete.
   */
  return { options, total: count ?? options.length };
}

/**
 * Variant ids this merchant already has an offer on, in any status.
 *
 * The picker disables these rather than hiding them: "you already sell this" is a different and more
 * useful answer than absence, and it is the same answer the unique constraint would give after the
 * merchant had filled in the whole form.
 */
export async function myOfferedVariantIds(merchantId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('merchant_offers')
    .select('variant_id')
    .eq('merchant_id', merchantId);

  if (error) {
    logger.error('myOfferedVariantIds failed', { cause: error.message });
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.variant_id));
}

/**
 * What settlement pays per unit at each of a set of retail prices, keyed by price in cents.
 *
 * The offer form shows this next to every variant in its picker, because a merchant deciding what to
 * ask has to see what BioCode will actually pay. One round trip through `merchant_settlement_units`,
 * which delegates to `merchant_settlement` — so the number here, the number in
 * `v_merchant_offer_detail` and the number on a future statement are the same arithmetic and not
 * three copies of it.
 */
export async function settlementByUnitPrice(
  merchantId: string,
  unitPricesCents: number[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  const prices = [...new Set(unitPricesCents.filter((price) => price > 0))];
  if (prices.length === 0) return result;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('merchant_settlement_units', {
    p_merchant_id: merchantId,
    p_unit_prices: prices,
  });

  if (error) {
    logger.error('settlementByUnitPrice failed', { cause: error.message });
    return result;
  }

  for (const row of (data ?? []) as {
    unit_price_cents: number;
    merchant_due_cents: number;
  }[]) {
    result.set(row.unit_price_cents, row.merchant_due_cents);
  }
  return result;
}

/**
 * The marketplace's cap on handling days, for the form that has to state it.
 *
 * Duplicated as a read here and in `offer-actions.ts` on purpose: the action must not trust a number
 * the form rendered, and the form must not guess at one the action will enforce. Both read the
 * setting.
 */
export async function marketplaceMaxHandlingDays(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'marketplace')
    .maybeSingle();

  const value = (data as { value: Record<string, unknown> } | null)?.value ?? {};
  const configured = value.merchant_max_handling_days;
  return typeof configured === 'number' && configured > 0 ? configured : 3;
}

/**
 * Which of this merchant's approved offers are actually in the buy box.
 *
 * The one number a merchant most wants and the one no offer row can answer: an approved, in-stock
 * offer still loses to BioCode's own stock and to a cheaper rival (§1). Answered by asking
 * `variant_buy_box` about the merchant's own variants and counting the wins, so the portal and the
 * storefront cannot disagree about it.
 *
 * Returns the set of winning offer ids, so a caller can badge a list as well as count it.
 */
export async function myWinningOfferIds(offers: OfferRow[]): Promise<Set<string>> {
  const winning = new Set<string>();

  const live = offers.filter((offer) => offer.status === 'approved' && offer.stockOnHand > 0);
  if (live.length === 0) return winning;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('variant_buy_box', {
    p_variant_ids: live.map((offer) => offer.variantId),
  });

  if (error) {
    logger.error('myWinningOfferIds failed', { cause: error.message });
    return winning;
  }

  const byVariant = new Map<string, string | null>();
  for (const row of (data ?? []) as { variant_id: string; offer_id: string | null }[]) {
    byVariant.set(row.variant_id, row.offer_id);
  }

  for (const offer of live) {
    if (byVariant.get(offer.variantId) === offer.id) winning.add(offer.id);
  }
  return winning;
}
