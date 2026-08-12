import { describe, expect, it } from 'vitest';
import {
  EMPTY_PENDING,
  PENDING_QUEUE_COLUMNS,
  PENDING_QUEUE_HREFS,
  pendingByHref,
  pendingQueues,
} from '@/features/admin/pending-queues';
import { ALL_NAV_ITEMS, IMPLEMENTED_ROUTES, visibleNav } from '@/features/admin/roles';

/**
 * Guards for the queue badges.
 *
 * The badge joins a count to a nav item **by route string**, which is the fragile part: nothing in the
 * type system connects `'/admin/merchants/proposals'` in `pending-queues.ts` to the `NavItem` of that
 * name,
 * so renaming a route would drop that badge silently and the queue would go back to being invisible —
 * the exact defect this feature was built to fix. These tests are what make that a failure instead.
 */
describe('pending queue wiring', () => {
  it('points every queue at a nav item that exists', () => {
    const known = new Set(ALL_NAV_ITEMS.map((item) => item.href));
    const orphans = PENDING_QUEUE_HREFS.filter((href) => !known.has(href));
    expect(orphans).toEqual([]);
  });

  it('points every queue at a route that is actually shipped', () => {
    /*
     * A badge on a route missing from `IMPLEMENTED` would count real work onto a link the sidebar
     * filters away — visible nowhere, and the count would not even appear on the dashboard.
     */
    const unshipped = PENDING_QUEUE_HREFS.filter((href) => !IMPLEMENTED_ROUTES.has(href));
    expect(unshipped).toEqual([]);
  });

  it('claims every column the view returns', () => {
    // Adding a counter to `v_admin_pending` and forgetting to wire it to a route would ship a number
    // nobody ever sees. This is the only place that mismatch is detectable.
    const claimed = new Set(PENDING_QUEUE_COLUMNS);
    const unclaimed = Object.keys(EMPTY_PENDING).filter((column) => !claimed.has(column));
    expect(unclaimed).toEqual([]);
  });

  it('gives each queue its own column and its own route', () => {
    expect(new Set(PENDING_QUEUE_COLUMNS).size).toBe(PENDING_QUEUE_COLUMNS.length);
    expect(new Set(PENDING_QUEUE_HREFS).size).toBe(PENDING_QUEUE_HREFS.length);
  });

  it('only deep-links to a status a page will accept', () => {
    /*
     * An unrecognised `?status=` does not error — every one of these pages falls back to its default
     * tab — so a typo here produces a link that lands on the wrong list while looking correct. The
     * values are checked against the pages' own `STATUSES` arrays.
     */
    const accepted: Record<string, readonly string[]> = {
      '/admin/orders': ['pending'],
      '/admin/messages': ['new', 'replied'],
      '/admin/reviews': ['pending', 'approved', 'rejected'],
      '/admin/merchants/applications': ['pending', 'approved', 'rejected', 'suspended'],
      '/admin/merchants/proposals': ['pending', 'needs_info', 'approved', 'rejected'],
      '/admin/merchants/offers': ['pending_review', 'approved', 'paused', 'rejected', 'draft'],
    };

    const queues = pendingQueues(visibleNav('admin'), {
      ...EMPTY_PENDING,
      // One of everything, so every queue is present to be checked.
      ...Object.fromEntries(Object.keys(EMPTY_PENDING).map((key) => [key, 1])),
    } as typeof EMPTY_PENDING);

    for (const queue of queues) {
      const status = new URL(queue.link, 'https://example.test').searchParams.get('status');
      if (status === null) continue; // Pages with no status filter link bare, which is correct.
      expect(accepted[queue.href], `${queue.href} has no known status list`).toBeDefined();
      expect(accepted[queue.href]).toContain(status);
    }
  });
});

describe('pendingQueues', () => {
  const counts = { ...EMPTY_PENDING, proposals: 6, offers: 2, messages: 82 };

  it('drops empty queues and sorts the rest biggest first', () => {
    const queues = pendingQueues(visibleNav('admin'), counts);
    expect(queues.map((queue) => queue.count)).toEqual([82, 6, 2]);
    expect(queues.map((queue) => queue.href)).toEqual([
      '/admin/messages',
      '/admin/merchants/proposals',
      '/admin/merchants/offers',
    ]);
  });

  it('says nothing at all when every queue is clear', () => {
    expect(pendingQueues(visibleNav('admin'), EMPTY_PENDING)).toEqual([]);
  });

  it('hides queues the role cannot reach', () => {
    /*
     * The real point of the design: capability filtering is inherited from `visibleNav` rather than
     * re-derived, so it cannot drift from the sidebar. A warehouse manager has no `offers.review`, so
     * the 6 proposals and 2 offers must not reach them — while `content_manager` sees neither those
     * nor the messages, having no `customers.view`.
     */
    const warehouse = pendingQueues(visibleNav('warehouse_manager'), counts);
    expect(warehouse.map((queue) => queue.href)).not.toContain('/admin/merchants/proposals');
    expect(warehouse.map((queue) => queue.href)).not.toContain('/admin/merchants/offers');

    const support = pendingQueues(visibleNav('support'), counts);
    expect(support.map((queue) => queue.href)).toContain('/admin/messages');
  });

  it('takes its label from the nav item, so the two cannot disagree', () => {
    const queues = pendingQueues(visibleNav('admin'), counts);
    const labels = new Map(ALL_NAV_ITEMS.map((item) => [item.href, item.label]));
    for (const queue of queues) expect(queue.label).toBe(labels.get(queue.href));
  });

  it('pluralises against the count', () => {
    const one = pendingQueues(visibleNav('admin'), { ...EMPTY_PENDING, proposals: 1 });
    expect(one[0]?.phrase).toBe('1 product proposal to review');

    const many = pendingQueues(visibleNav('admin'), { ...EMPTY_PENDING, proposals: 2 });
    expect(many[0]?.phrase).toBe('2 product proposals to review');
  });

  it('keeps phrase and noun consistent', () => {
    for (const queue of pendingQueues(visibleNav('admin'), counts)) {
      expect(queue.phrase).toBe(`${queue.count} ${queue.noun}`);
    }
  });
});

describe('pendingByHref', () => {
  it('reduces to a serializable route→count map for the client nav', () => {
    const queues = pendingQueues(visibleNav('admin'), {
      ...EMPTY_PENDING,
      proposals: 6,
      messages: 82,
    });

    expect(pendingByHref(queues)).toEqual({
      '/admin/messages': 82,
      '/admin/merchants/proposals': 6,
    });
  });

  it('omits clear queues rather than mapping them to zero', () => {
    // `PendingBadge` renders nothing at zero either, but a map of eleven zeros would cross the
    // server→client boundary on every single admin page view for no reason.
    expect(pendingByHref(pendingQueues(visibleNav('admin'), EMPTY_PENDING))).toEqual({});
  });
});
