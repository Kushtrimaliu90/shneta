import type { LocalizedField } from '@/lib/i18n';

/** docs/07 §8.1 — the four cadences the toggle offers. */
export const FREQUENCIES = [30, 45, 60, 90] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export function toFrequency(value: unknown): Frequency | null {
  const days = Number(value);
  return (FREQUENCIES as readonly number[]).includes(days) ? (days as Frequency) : null;
}

export const SUBSCRIPTION_STATUSES = ['active', 'paused', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export function toSubscriptionStatus(value: string | null | undefined): SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as SubscriptionStatus)
    : 'active';
}

export interface SubscriptionItemView {
  id: string;
  variantId: string;
  quantity: number;
  sku: string;
  productSlug: string;
  productName: LocalizedField;
  variantName: LocalizedField;
  imagePath: string | null;
  priceCents: number;
  isAvailable: boolean;
}

export interface SubscriptionView {
  id: string;
  status: SubscriptionStatus;
  frequencyDays: number;
  nextRunAt: string;
  pausedUntil: string | null;
  discountPct: number;
  consecutiveFailures: number;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: SubscriptionItemView[];
  /** Line total before the subscription discount, in cents. */
  subtotalCents: number;
  /** What the discount takes off, in cents. */
  discountCents: number;
  /** Orders this subscription has generated, newest first. */
  orders: { orderNumber: string; placedAt: string; totalCents: number; status: string }[];
}

/** docs/06 §12 — one row of the admin list. */
export interface AdminSubscriptionRow {
  id: string;
  status: SubscriptionStatus;
  frequencyDays: number;
  nextRunAt: string;
  consecutiveFailures: number;
  customerEmail: string;
  customerName: string;
  itemCount: number;
  orderCount: number;
}
