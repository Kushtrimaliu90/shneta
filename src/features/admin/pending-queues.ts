import type { NavSection } from '@/features/admin/roles';

/**
 * What is waiting for a staff decision, across the whole panel — the pure half.
 *
 * ── The defect this exists for ──
 *
 * There was no way to learn that work existed. A merchant filed six proposals and the only surface
 * that said so was the proposals page itself, so the way to find out you had a queue was to already
 * suspect you had one. Counted on production the day this was written: 6 proposals, 2 offers awaiting
 * review, and **82 unanswered contact messages** — the last of which nobody had thought to ask about,
 * which is exactly why this covers every queue rather than the two that prompted the complaint.
 *
 * ── Why this is a separate file from `pending.ts` ──
 *
 * `pending.ts` is `server-only`, which is correct for a module that reads cookies through the SSR
 * Supabase client — but `server-only` throws on import under Vitest's jsdom environment, so none of the
 * logic below could be tested while it lived there. Splitting on that line is the right seam anyway: the
 * route mapping and the pluralising are pure functions over data, and the only thing that genuinely
 * needs a request context is the single `select`.
 *
 * ── Capability filtering is free, because the nav already did it ──
 *
 * The obvious design gives each queue a `Capability` and re-checks it here. That would be a second
 * copy of the permission matrix, and the copy that drifts: a queue whose capability disagreed with its
 * nav item would badge a link the role cannot see, or hide a badge on one it can.
 *
 * Instead the counts are keyed by **route** and decorated onto `visibleNav(role)`, which is already
 * filtered. A role that cannot reach `/admin/merchants/proposals` has no such nav item, so there is
 * nowhere to hang the badge and nothing to check. The two cannot disagree because there is only one
 * decision, made in one place.
 *
 * RLS is the actual boundary underneath, not this: `v_admin_pending` is `security_invoker`, so a role
 * with no policy on `contact_messages` counts zero of them regardless of what this file does.
 */

/** The view's columns. Keys are snake_case because they are Postgres column names. */
export interface PendingRow {
  merchant_applications: number;
  proposals: number;
  offers: number;
  payouts: number;
  unassigned_fulfilments: number;
  orders_to_confirm: number;
  messages: number;
  reviews: number;
  compliance: number;
  placements: number;
  referrals: number;
}

/**
 * One queue: which column counts it, which nav route owns it, and how to say it in a sentence.
 *
 * `href` must match a `NavItem.href` exactly — that is the join key for the badge, and
 * `tests/unit/admin-pending.test.ts` asserts every one of these resolves to a real nav item, so a
 * renamed route fails a test instead of silently dropping a badge.
 *
 * `link` is where the *dashboard* sends you, which is not always `href`: a queue page that supports
 * `?status=` should open on the filter that matches the count, or an operator arrives at a list of
 * 200 rows and has to find the 6. Only the values each page actually accepts are used here — every
 * one of these was read off the page's own `STATUSES` array, because an unrecognised value silently
 * falls back to the default tab and the link would land on the wrong list while looking correct.
 */
const QUEUES: readonly {
  column: keyof PendingRow;
  href: string;
  link: string;
  one: string;
  many: string;
}[] = [
  {
    column: 'orders_to_confirm',
    href: '/admin/orders',
    link: '/admin/orders?status=pending',
    one: 'order to confirm',
    many: 'orders to confirm',
  },
  {
    column: 'messages',
    href: '/admin/messages',
    link: '/admin/messages?status=new',
    one: 'unanswered message',
    many: 'unanswered messages',
  },
  {
    column: 'merchant_applications',
    href: '/admin/merchants/applications',
    link: '/admin/merchants/applications?status=pending',
    one: 'merchant application to review',
    many: 'merchant applications to review',
  },
  {
    column: 'proposals',
    href: '/admin/merchants/proposals',
    link: '/admin/merchants/proposals?status=pending',
    one: 'product proposal to review',
    many: 'product proposals to review',
  },
  {
    /*
     * Includes price changes. A merchant editing the price of an already-approved offer sends it back
     * to `pending_review` (migration 20260810000300), so it appears in this count with no separate
     * counter — which is the behaviour worth having, since a price change is exactly the thing an
     * admin must not miss.
     */
    column: 'offers',
    href: '/admin/merchants/offers',
    link: '/admin/merchants/offers?status=pending_review',
    one: 'merchant offer to review',
    many: 'merchant offers to review',
  },
  {
    column: 'compliance',
    href: '/admin/compliance',
    link: '/admin/compliance',
    one: 'product awaiting compliance sign-off',
    many: 'products awaiting compliance sign-off',
  },
  {
    column: 'reviews',
    href: '/admin/reviews',
    link: '/admin/reviews?status=pending',
    one: 'review to moderate',
    many: 'reviews to moderate',
  },
  {
    column: 'referrals',
    href: '/admin/referrals',
    link: '/admin/referrals',
    one: 'referral link to check',
    many: 'referral links to check',
  },
  {
    column: 'placements',
    href: '/admin/placements',
    link: '/admin/placements',
    one: 'sponsored slot awaiting approval',
    many: 'sponsored slots awaiting approval',
  },
  {
    column: 'unassigned_fulfilments',
    href: '/admin/routing',
    link: '/admin/routing',
    one: 'shipment to route',
    many: 'shipments to route',
  },
  {
    column: 'payouts',
    href: '/admin/payouts',
    link: '/admin/payouts',
    one: 'payout to settle',
    many: 'payouts to settle',
  },
];

/** Exported for the guard test described above. */
export const PENDING_QUEUE_HREFS: readonly string[] = QUEUES.map((queue) => queue.href);

/** Also for the test: which view column each queue reads, so none can be left unbadged. */
export const PENDING_QUEUE_COLUMNS: readonly string[] = QUEUES.map((queue) => queue.column);

export interface PendingQueue {
  href: string;
  link: string;
  /** The nav item's own label, so the badge and the sidebar cannot name the same place differently. */
  label: string;
  count: number;
  /** "product proposals to review" — already pluralised against `count`, without the number. */
  noun: string;
  /**
   * "6 product proposals to review".
   *
   * Kept alongside `noun` because the dashboard renders the number in bold and the noun beside it,
   * which splits the sentence into two elements — fine visually, but it leaves a screen reader to
   * reassemble it. The whole phrase goes in the link's accessible name instead.
   */
  phrase: string;
}

/**
 * Zeros — the fallback when the read fails, and the canonical list of the view's columns.
 *
 * The test uses its keys to assert every column is claimed by some queue, so adding a counter to the
 * view without wiring it to a route fails a test rather than shipping a number nobody ever sees.
 */
export const EMPTY_PENDING: PendingRow = {
  merchant_applications: 0,
  proposals: 0,
  offers: 0,
  payouts: 0,
  unassigned_fulfilments: 0,
  orders_to_confirm: 0,
  messages: 0,
  reviews: 0,
  compliance: 0,
  placements: 0,
  referrals: 0,
};

/**
 * The queues this role can actually reach, non-empty ones only, biggest first.
 *
 * `sections` is the already-filtered `visibleNav(role)` output — see the header. Sorting by size puts
 * the real backlog at the top of the dashboard panel rather than wherever it fell in `QUEUES`.
 */
export function pendingQueues(sections: NavSection[], counts: PendingRow): PendingQueue[] {
  const labels = new Map(
    sections.flatMap((section) => section.items.map((item) => [item.href, item.label] as const)),
  );

  return QUEUES.flatMap((queue) => {
    const label = labels.get(queue.href);
    const count = counts[queue.column];
    // No nav item means the role cannot reach the page; zero means there is nothing to say.
    if (label === undefined || count === 0) return [];

    const noun = count === 1 ? queue.one : queue.many;

    return [
      {
        href: queue.href,
        link: queue.link,
        label,
        count,
        noun,
        phrase: `${count} ${noun}`,
      },
    ];
  }).sort((a, b) => b.count - a.count);
}

/**
 * Counts keyed by route, for the sidebar and the drawer.
 *
 * A plain object rather than a `Map` because this crosses the server→client boundary as a prop, and
 * the same lesson as `NavItem.icon` applies: only serializable values survive the trip.
 */
export function pendingByHref(queues: PendingQueue[]): Record<string, number> {
  return Object.fromEntries(queues.map((queue) => [queue.href, queue.count]));
}
