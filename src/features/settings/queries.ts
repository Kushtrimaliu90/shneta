import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/06 §15 — the settings suite reads.
 *
 * `settings` is a key→jsonb table, which is right for configuration nobody queries by value and
 * wrong for anything that needs a constraint. So the *shape* of each row is enforced here and in
 * the Zod schemas rather than by the database, and every reader defaults rather than assuming:
 * a missing key must degrade to a sensible value, not to a crash on a page an operator opened to
 * fix exactly that.
 */

export type SettingsGroup =
  'store' | 'tax' | 'loyalty' | 'checkout' | 'inventory' | 'subscriptions' | 'referral';

export interface StoreSettings {
  name: string;
  email: string;
  phone: string;
  address: string;
  instagram: string;
  tiktok: string;
  facebook: string;
  announcement: string;
}

export interface TaxSettings {
  rate: number;
}

export interface LoyaltySettings {
  earnRatePointsPerEur: number;
  /** docs/17 §0.1 — one point value, and the floor on a redemption in multiples of 100. */
  pointValueCents: number;
  minRedeemPoints: number;
}

/**
 * docs/17 §2 — the referral programme's dials.
 *
 * `ratePct` is the only one that changes what a referrer is paid, and it changes it **prospectively**:
 * the terms page says so, and an accrual that has already happened is a row in `referral_earnings` that
 * nothing here rewrites.
 */
export interface ReferralSettings {
  enabled: boolean;
  ratePct: number;
  durationMonths: number;
  autoApprove: boolean;
  /** `monthly` batches the wallet movement — a privacy decision, not a performance one (§0.2). */
  accrualMode: 'monthly' | 'immediate';
  minOrderCentsToCount: number;
  maxPointsPerLinkPerYear: number;
}

export interface CheckoutSettings {
  maxItemQty: number;
  codEnabled: boolean;
  bankPosEnabled: boolean;
}

export interface SubscriptionSettings {
  discountPct: number;
  noticeDays: number;
}

export interface AllSettings {
  store: StoreSettings;
  tax: TaxSettings;
  loyalty: LoyaltySettings;
  referral: ReferralSettings;
  checkout: CheckoutSettings;
  subscriptions: SubscriptionSettings;
}

function text(value: Record<string, unknown>, key: string, fallback = ''): string {
  return typeof value[key] === 'string' ? (value[key] as string) : fallback;
}

function num(value: Record<string, unknown>, key: string, fallback: number): number {
  const raw = value[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

function bool(value: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof value[key] === 'boolean' ? (value[key] as boolean) : fallback;
}

/** Every settings row in one read, defaulted. */
export async function getAllSettings(): Promise<AllSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('settings').select('key, value');

  if (error) logger.error('getAllSettings failed', { cause: error.message });

  const rows = (data ?? []) as { key: string; value: Json }[];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (row.value && typeof row.value === 'object' && !Array.isArray(row.value)) {
      byKey.set(row.key, row.value as Record<string, unknown>);
    }
  }

  const store = byKey.get('store') ?? {};
  const tax = byKey.get('tax') ?? {};
  const loyalty = byKey.get('loyalty') ?? {};
  const referral = byKey.get('referral') ?? {};
  const checkout = byKey.get('checkout') ?? {};
  const subscriptions = byKey.get('subscriptions') ?? {};

  return {
    store: {
      name: text(store, 'name', 'BIOCODE'),
      email: text(store, 'email'),
      phone: text(store, 'phone'),
      address: text(store, 'address'),
      instagram: text(store, 'instagram'),
      tiktok: text(store, 'tiktok'),
      facebook: text(store, 'facebook'),
      announcement: text(store, 'announcement'),
    },
    tax: { rate: num(tax, 'rate', 18) },
    loyalty: {
      earnRatePointsPerEur: num(
        loyalty,
        'earn_points_per_eur',
        num(loyalty, 'earn_rate_points_per_eur', 1),
      ),
      pointValueCents: num(loyalty, 'point_value_cents', 1),
      minRedeemPoints: num(loyalty, 'min_redeem_points', 500),
    },
    referral: {
      enabled: bool(referral, 'enabled', false),
      ratePct: num(referral, 'rate_pct', 1),
      durationMonths: num(referral, 'duration_months', 12),
      autoApprove: bool(referral, 'auto_approve', false),
      accrualMode: referral.accrual_mode === 'immediate' ? 'immediate' : 'monthly',
      minOrderCentsToCount: num(referral, 'min_order_cents_to_count', 1000),
      maxPointsPerLinkPerYear: num(referral, 'max_points_per_link_per_year', 20000),
    },
    checkout: {
      maxItemQty: num(checkout, 'max_item_qty', 20),
      codEnabled: bool(checkout, 'cod_enabled', true),
      bankPosEnabled: bool(checkout, 'bank_pos_enabled', false),
    },
    subscriptions: {
      // `discount_pct` is the key the engine reads; `default_discount_pct` is the older name.
      discountPct: num(
        subscriptions,
        'discount_pct',
        num(subscriptions, 'default_discount_pct', 10),
      ),
      noticeDays: num(subscriptions, 'notice_days', 3),
    },
  };
}

export interface ShippingMethodRow {
  id: string;
  nameSq: string;
  nameEn: string;
  priceCents: number;
  freeOverCents: number | null;
  minDays: number;
  maxDays: number;
  countries: string[];
  isActive: boolean;
  position: number;
}

export async function listShippingMethods(): Promise<ShippingMethodRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('shipping_methods')
    .select(
      'id, name, description, price_cents, free_over_cents, min_days, max_days, countries, is_active, position',
    )
    .order('position', { ascending: true });

  if (error) {
    logger.error('listShippingMethods failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => {
    const name = (row.name ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      nameSq: typeof name.sq === 'string' ? name.sq : '',
      nameEn: typeof name.en === 'string' ? name.en : '',
      priceCents: row.price_cents,
      freeOverCents: row.free_over_cents,
      minDays: row.min_days,
      maxDays: row.max_days,
      countries: row.countries ?? [],
      isActive: row.is_active,
      position: row.position,
    };
  });
}

export interface TeamMember {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  createdAt: string;
  deactivated: boolean;
}

/**
 * docs/06 §15 — the staff list.
 *
 * "Deactivated" is `deleted_at is not null` on the profile. There is no separate flag: the
 * schema already has a soft-delete column, and a second boolean meaning nearly the same thing
 * is how two sources of truth for "can this person sign in" come into being.
 */
export async function listTeam(): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, created_at, deleted_at')
    .neq('role', 'customer')
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('listTeam failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    createdAt: row.created_at,
    deactivated: row.deleted_at !== null,
  }));
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  before: Json;
  after: Json;
  ip: string | null;
  createdAt: string;
}

export const AUDIT_PAGE_SIZE = 40;

export interface AuditFilters {
  actor?: string;
  entityType?: string;
  action?: string;
  from?: string;
  to?: string;
  before?: string;
}

/** docs/06 §15 — the audit log, admin-only by `p_admin_read on audit_logs`. */
export async function listAudit(
  filters: AuditFilters = {},
): Promise<{ rows: AuditRow[]; nextCursor: string | null }> {
  const supabase = await createClient();

  let query = supabase
    .from('audit_logs')
    .select(
      'id, action, entity_type, entity_id, actor_role, before, after, ip, created_at, profiles ( email )',
    )
    .order('created_at', { ascending: false })
    .limit(AUDIT_PAGE_SIZE + 1);

  if (filters.entityType) query = query.eq('entity_type', filters.entityType);
  if (filters.action) query = query.like('action', `${filters.action}%`);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) query = query.lt('created_at', `${filters.to}T23:59:59.999Z`);
  if (filters.before) query = query.lt('created_at', filters.before);

  const { data, error } = await query;

  if (error) {
    logger.error('listAudit failed', { cause: error.message });
    return { rows: [], nextCursor: null };
  }

  type Raw = {
    id: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    actor_role: string | null;
    before: Json;
    after: Json;
    ip: string | null;
    created_at: string;
    profiles: { email: string } | null;
  };

  let raw = (data ?? []) as unknown as Raw[];

  /*
   * Actor is filtered here rather than in SQL. PostgREST cannot put an `ilike` on an embedded
   * table into the outer `where` without turning the join into an inner one, which would then
   * silently drop every row whose actor is null — and a null actor is exactly what a
   * service-role or cron write looks like. Filtering after the read keeps those visible when no
   * actor filter is set, which is the common case.
   */
  if (filters.actor) {
    const needle = filters.actor.toLowerCase();
    raw = raw.filter((row) => (row.profiles?.email ?? '').toLowerCase().includes(needle));
  }

  const hasMore = raw.length > AUDIT_PAGE_SIZE;
  const page = hasMore ? raw.slice(0, AUDIT_PAGE_SIZE) : raw;

  const rows: AuditRow[] = page.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorEmail: row.profiles?.email ?? null,
    actorRole: row.actor_role,
    before: row.before,
    after: row.after,
    ip: row.ip,
    createdAt: row.created_at,
  }));

  return { rows, nextCursor: hasMore ? (rows[rows.length - 1]?.createdAt ?? null) : null };
}

/** The distinct entity types present, for the filter chips. */
export async function listAuditEntityTypes(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('audit_logs').select('entity_type').limit(1000);
  const set = new Set((data ?? []).map((row) => row.entity_type));
  return [...set].sort();
}
