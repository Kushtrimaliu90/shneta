import { cn } from '@/lib/utils';

/**
 * The count pill on a sidebar item: "there is work behind this link".
 *
 * ── Colour ──
 *
 * `forest-700` with white text, which `tests/unit/contrast.test.ts` already asserts at AA. Brand
 * green rather than amber or red on purpose: a queue with items in it is the normal state of a working
 * shop, not a fault. Amber would be lit on every page all day — 82 unanswered messages the morning
 * this shipped — and a warning colour that is always on stops being read as a warning. Urgency belongs
 * on the dashboard panel, which can say how old the backlog is; a nav badge only has room to say that
 * it exists.
 *
 * ── Why the number is capped ──
 *
 * `99+` past two digits. The sidebar is a fixed 15rem rail and the label beside this can already be as
 * long as "Merchant offers"; letting a four-digit count set the pill's width would push labels into
 * ellipsis on exactly the busy day the badge matters most. The precise figure is on the dashboard.
 */
export function PendingBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;

  return (
    <span
      className={cn(
        'ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-forest-700 px-1.5 py-px font-ui text-[11px] font-semibold text-white tabular-nums',
        className,
      )}
      /*
       * The label carries the meaning, because the number alone does not. A screen reader on a nav
       * item would otherwise announce "Proposals 6", which could as easily be a sixth item in a list
       * as six things waiting.
       */
      aria-label={`${count} waiting`}
      data-numeric
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
