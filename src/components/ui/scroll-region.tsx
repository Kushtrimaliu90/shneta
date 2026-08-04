import { cn } from '@/lib/utils';

/**
 * A horizontally scrolling container a keyboard can actually scroll.
 *
 * ── The bug this exists to stop repeating ──
 *
 * A bare `overflow-x-auto` div scrolls with a mouse or a finger and **cannot be reached by the keyboard
 * at all**: it takes no focus, so arrow keys never reach it and its right-hand columns are unreachable
 * for anyone not using a pointer. axe reports it as `scrollable-region-focusable`, serious impact, and
 * it fired on the merchant fulfilment page at 390 px — where a two-column table genuinely does overflow.
 *
 * `tabIndex={0}` makes the region a tab stop, and a `role="region"` with a name says what the tab stop
 * is when a screen reader lands on it. Both are required: a focusable div with no accessible name is a
 * tab stop that announces nothing.
 *
 * The label is normally the table's own caption text, which every table here already has for screen
 * readers — so this asks for it rather than inventing a second description that can drift.
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  /** What the region contains, announced when focus lands on it. Usually the table's caption. */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        'overflow-x-auto',
        // The focus ring matters more here than anywhere: this is a tab stop with no visible control.
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-700',
        className,
      )}
    >
      {children}
    </div>
  );
}
