'use client';

import { useEffect, useRef } from 'react';
import { logSearchClick } from '@/features/search/actions';

/**
 * Records which result a shopper actually opened.
 *
 * A query that returns results and gets no clicks is a **ranking** failure, and it is the one failure
 * mode invisible to every other measure: the search "worked", the page rendered, the count was healthy,
 * and nobody wanted any of it. Recording the click, and its position, is what separates that from a query
 * that genuinely served someone.
 *
 * ── Delegation, and why ──
 *
 * One listener on a wrapper rather than a handler threaded through `ProductGrid` into `ProductCard`. The
 * card is shared with the shop grid, the home page and the compare tray; giving it a search-only prop
 * would put analytics plumbing in four places that have nothing to do with search.
 *
 * The listener is attached in an effect rather than as an `onClick` prop because this div is not
 * interactive and should not be described as though it were — the real controls are the anchors inside
 * it, which keep their own semantics and keyboard behaviour untouched.
 *
 * Keyboard activation of a link fires `click` too, so this is not mouse-only.
 */
export function SearchClickTracker({
  eventId,
  items,
  children,
}: {
  eventId: string;
  /** In rendered order — the index is the position reported. */
  items: { slug: string; id: string }[];
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest('a[href]');
      if (!anchor) return;

      /*
       * Matched on the href rather than a data attribute, so the card stays unaware of this. The locale
       * prefix (`/en/product/...`) is why the slug is captured rather than the whole path compared.
       */
      const slug = /\/product\/([^/?#]+)/.exec(anchor.getAttribute('href') ?? '')?.[1];
      if (!slug) return;

      const decoded = decodeURIComponent(slug);
      const index = items.findIndex((item) => item.slug === decoded);
      const hit = index >= 0 ? items[index] : undefined;
      if (!hit) return;

      // Fire-and-forget. Navigation here is client-side, so the page does not unload and the request
      // completes; and if it does not, a lost analytics row is the correct thing to lose.
      void logSearchClick(eventId, hit.id, index + 1);
    };

    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [eventId, items]);

  return <div ref={ref}>{children}</div>;
}
