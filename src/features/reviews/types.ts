import type { LocalizedField } from '@/lib/i18n';

/** docs/03 §1 — the `review_status` enum. */
export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export function toReviewStatus(value: string | null | undefined): ReviewStatus | undefined {
  return (REVIEW_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as ReviewStatus)
    : undefined;
}

/** One approved review as the PDP renders it. */
export interface ReviewView {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string;
  createdAt: string;
  helpfulCount: number;
  adminReply: string | null;
  /** docs/05 §3 — the badge is earned by an `order_id` the RLS policy proved (docs/13 §B3). */
  isVerified: boolean;
  /** Whether the signed-in reader has already voted it helpful. */
  hasVoted: boolean;
  /** True when the signed-in reader wrote it — their own pending review is visible to them. */
  isOwn: boolean;
  status: ReviewStatus;
}

/** The five-bar distribution plus the headline numbers. */
export interface ReviewSummary {
  average: number;
  total: number;
  /** Index 0 is one star, index 4 is five. */
  distribution: [number, number, number, number, number];
}

export interface ReviewPage {
  items: ReviewView[];
  summary: ReviewSummary;
  page: number;
  pageCount: number;
}

/** What the PDP needs to decide which of the three "write a review" states to show. */
export type ReviewEligibility =
  | { kind: 'signed_out' }
  | { kind: 'not_purchased' }
  | { kind: 'already_reviewed' }
  | { kind: 'eligible'; orderId: string };

/** A review in the moderation queue, with the product it belongs to. */
export interface ModerationReview extends ReviewView {
  productId: string;
  productSlug: string;
  productName: LocalizedField;
  rejectionReason: string | null;
}

/** One of the customer's own reviews, on `/account/reviews`. */
export interface OwnReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  createdAt: string;
  status: ReviewStatus;
  rejectionReason: string | null;
  adminReply: string | null;
  productSlug: string;
  productName: LocalizedField;
  productImagePath: string | null;
}

export const REVIEWS_PER_PAGE = 5;
