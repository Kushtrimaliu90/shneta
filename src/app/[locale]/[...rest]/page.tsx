import { notFound } from 'next/navigation';

/**
 * Catch-all that hands unmatched paths to the localized `not-found.tsx`.
 *
 * Without it, a URL that matches no route never enters the `[locale]` segment, so Next
 * falls back to its own untranslated `404` page — bypassing the storefront chrome, the
 * locale and the brand entirely. The middleware has already rewritten `/whatever` to
 * `/sq/whatever`, so this segment is what makes that path resolvable enough for the
 * boundary above it to render.
 *
 * More specific routes always win over a catch-all, so adding real pages needs no change here.
 */
export default function CatchAllNotFound(): never {
  notFound();
}
