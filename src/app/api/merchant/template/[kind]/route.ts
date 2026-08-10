import { NextResponse, type NextRequest } from 'next/server';
import { buildTemplate, type OfferSeedRow, type TemplateKind } from '@/lib/sheet/template';
import { getMyMerchant, listMyOffers } from '@/features/merchants/queries';
import { pickLocale } from '@/lib/i18n';

/**
 * The sample workbook, at `/api/merchant/template/offers` and `/api/merchant/template/proposals`.
 *
 * A route handler because the file is generated per merchant: the offers sheet arrives with that
 * merchant's own SKUs, stock and prices already in it, so updating stock is typing over numbers rather
 * than building a spreadsheet. The proposals sheet has no such data to seed — BioCode does not know what
 * the merchant wants to propose — so it carries one greyed example row instead.
 *
 * Generated on request rather than cached: a merchant downloads this to change something, so a stale
 * copy of their stock would be worse than the extra second.
 */
export const dynamic = 'force-dynamic';

const KINDS: TemplateKind[] = ['offers', 'proposals'];

export async function GET(_request: NextRequest, context: { params: Promise<{ kind: string }> }) {
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const { kind: raw } = await context.params;
  const kind = KINDS.find((candidate) => candidate === raw);
  if (!kind) return NextResponse.json({ ok: false }, { status: 404 });

  let seed: OfferSeedRow[] = [];
  if (kind === 'offers') {
    /*
     * Every status, not only the live ones.
     *
     * A merchant whose offer is paused or awaiting review still needs it in the sheet — leaving it out
     * would read as BioCode having lost it, and re-adding it by hand is how a duplicate SKU row appears.
     */
    const offers = await listMyOffers();
    seed = offers.map((offer) => ({
      sku: offer.sku,
      // The product name is a jsonb `{sq, en}`; the sheet is a merchant's working document, so Albanian.
      productName: pickLocale(offer.productName, 'sq'),
      stockOnHand: offer.stockOnHand,
      priceCents: offer.askingPriceCents,
    }));
  }

  const file = await buildTemplate(kind, seed);
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(file, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="biocode-${kind}-${today}.xlsx"`,
      // Per-merchant and generated fresh; a shared cache holding one merchant's stock would be a leak.
      'cache-control': 'private, no-store',
    },
  });
}
