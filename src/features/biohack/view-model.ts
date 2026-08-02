import 'server-only';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { getProtocolGoals, getProtocolProducts } from '@/features/biohack/queries';
import type { ProductCard } from '@/features/biohack/components/protocol-view';
import type { ProtocolResult } from '@/features/biohack/types';

/**
 * The two lookups every surface that renders a protocol needs: goal names, and product cards.
 *
 * Shared by the result page, the share page and the admin simulator. Kept out of the view so the
 * view stays a Client Component with no data access, and out of each page so the three cannot
 * drift into showing a protocol three slightly different ways.
 */
export async function protocolViewProps(
  result: ProtocolResult,
  locale: Locale,
): Promise<{ products: Record<string, ProductCard>; goalNames: Record<string, string> }> {
  const productIds = [
    ...new Set(
      result.items
        .concat(result.alternates)
        .map((item) => item.product?.productId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [goals, products] = await Promise.all([
    getProtocolGoals(),
    getProtocolProducts(productIds),
  ]);

  const goalNames: Record<string, string> = {};
  for (const goal of goals) goalNames[goal.slug] = pickLocale(goal.name, locale);

  const cards: Record<string, ProductCard> = {};
  for (const product of products) {
    cards[product.id] = {
      id: product.id,
      slug: product.slug,
      // `LocalizedField` is `Partial<Record<Locale, string>>`; the view takes the wider record so
      // it can stay free of the i18n types.
      name: (product.name ?? null) as Record<string, string> | null,
      brandName: product.brandName,
      imagePath: product.imagePath,
    };
  }

  return { products: cards, goalNames };
}
