import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A long list of options, shortened to its first few with a toggle for the rest.
 *
 * ── What was wrong with the four hand-rolled copies ──
 *
 * The filter panel had this twice, categories and brands, written out inline; goals and dietary tags had
 * no shortening at all. Every copy shared the same faults, which is what makes this a primitive rather
 * than a patch:
 *
 *   1. **The label never changed.** `<summary>` read "Shfaq të 12" whether the list was open or closed.
 *      Reported from the shop with all twelve categories on screen under a control still offering to show
 *      them — which reads as a broken button, because a control that does not acknowledge being pressed is
 *      indistinguishable from one that did nothing.
 *   2. **The number was the total, not what was hidden.** Six were already visible, so "show all 12" asked
 *      the reader to do arithmetic to find out that six more existed.
 *   3. **The toggle sat between item six and item seven.** The `<details>` element carried its own `<ul>`,
 *      so the markup was list / control / list and the control read as an option in the middle of the
 *      group. In the screenshot it looks like a category called "Show all 12".
 *   4. **Nothing said a hidden option was active.** The group force-opened when one was, which is right,
 *      but a collapsed group gave no hint that a filter inside it was narrowing the results.
 *
 * ── Still no JavaScript ──
 *
 * `<details>` because the filter panel is server-rendered links that work before hydration and identically
 * in the desktop sidebar and the mobile sheet. The label problem is solved with CSS rather than state:
 * both labels are rendered and `details[open]` picks one. So the label is correct in the same paint as the
 * list, with no client bundle and no flash.
 *
 * ── One thing it deliberately does not do ──
 *
 * Expansion does not survive a click. Each option is a link, so the server re-renders and `open` is
 * recomputed from whether a hidden option is active. Somebody who expands the list to browse, then picks a
 * *visible* option, sees it collapse again. Fixing that needs either a URL parameter — which the faceted
 * crawl rules in `robots.ts` exist to keep out of URLs — or client state that survives a soft navigation,
 * which a server-rendered panel cannot hold. Recorded rather than hidden.
 */
export function CollapsibleList<T>({
  items,
  visible = 6,
  renderItem,
  keyOf,
  isActive,
  labels,
  className,
}: {
  items: readonly T[];
  /** How many stay on screen when collapsed. */
  visible?: number;
  renderItem: (item: T) => ReactNode;
  keyOf: (item: T) => string;
  /**
   * Whether an item is currently selected. Used for two things: forcing the group open when the selection
   * is hidden, and counting the badge that says so.
   */
  isActive?: (item: T) => boolean;
  labels: {
    /** Takes `{count}` — the number still hidden, not the total. */
    showAll: string;
    showFewer: string;
    /** Takes `{count}` — active selections among the hidden items. */
    activeHidden: string;
  };
  className?: string;
}) {
  const lead = items.slice(0, visible);
  const rest = items.slice(visible);

  const list = (entries: readonly T[]) => (
    <ul className="flex flex-col gap-0.5">
      {entries.map((item) => (
        <li key={keyOf(item)}>{renderItem(item)}</li>
      ))}
    </ul>
  );

  // Nothing to collapse: render the list and no control at all, rather than a toggle that reveals nothing.
  if (rest.length === 0) return <div className={className}>{list(items)}</div>;

  const activeHidden = isActive ? rest.filter((item) => isActive(item)).length : 0;
  const fill = (template: string, count: number) => template.replace('{count}', String(count));

  return (
    <div className={cn('flex flex-col', className)}>
      {list(lead)}

      {/*
        `open` when a hidden option is selected, so a filter can never be narrowing the results from inside
        a closed group. `[&_summary]:list-none` and the webkit rule remove the disclosure triangle, which
        would otherwise appear in the middle of a list of plain links.
      */}
      <details
        open={activeHidden > 0}
        className="[&_summary::-webkit-details-marker]:hidden [&_summary]:list-none"
      >
        <summary className="mt-0.5 flex min-h-9 cursor-pointer items-center gap-1.5 rounded-sm px-2 text-sm text-forest-700 hover:bg-forest-50">
          {/*
            Both labels, one shown. `group-open` is not usable here — `details` is the group and Tailwind's
            `open:` variant applies to the element itself — so the state is read from the parent with an
            arbitrary selector. This is the whole fix for the label that never changed.
          */}
          <span className="[details[open]_&]:hidden">{fill(labels.showAll, rest.length)}</span>
          <span className="hidden [details[open]_&]:inline">{labels.showFewer}</span>

          {/*
            The badge only means something while collapsed: once open, the selected options are visible and
            highlighted, so repeating the count would be noise.
          */}
          {activeHidden > 0 && (
            <span className="rounded-full bg-forest-100 px-1.5 font-ui text-[11px] font-semibold text-forest-900 [details[open]_&]:hidden">
              {fill(labels.activeHidden, activeHidden)}
            </span>
          )}
        </summary>

        {list(rest)}
      </details>
    </div>
  );
}
