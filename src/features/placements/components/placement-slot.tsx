import { listPlacements } from '@/features/placements/queries';
import { PlacementBanner } from '@/features/placements/components/placement-banner';

/**
 * The slot, including what happens when nothing is sold.
 *
 * ── Never an empty box ──
 *
 * The brief is explicit and it is the right call commercially: a shopper who sees a reserved grey
 * rectangle learns that the shop has advertising space nobody wanted. So the fallback order is
 *
 *   1. whatever paid placements qualify for this page;
 *   2. failing that, a BioCode own-brand promotion — configured as a placement with `is_paid = false`
 *      and no targeting, so it qualifies everywhere and carries no Sponsored label;
 *   3. failing that, **nothing at all**, with no reserved height.
 *
 * Step two needs no special code path. An own-brand promo is just a placement, which means it goes
 * through the same approval, the same scheduling and the same reporting — and the day a paid campaign
 * outranks it on weight, it steps aside on its own.
 *
 * ── Collapsing means collapsing ──
 *
 * `null`, not an empty div with a height. The brief asks for no reserved space when there is nothing
 * to show, and a zero-height wrapper still contributes its margins.
 */
export async function PlacementSlot({
  categorySlug,
  brandSlug,
}: {
  categorySlug?: string | null;
  brandSlug?: string | null;
}) {
  const placements = await listPlacements({ categorySlug, brandSlug });
  if (placements.length === 0) return null;

  return <PlacementBanner placements={placements} />;
}
