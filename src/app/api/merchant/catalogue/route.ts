import { NextResponse } from 'next/server';
import { getMyMerchant } from '@/features/merchants/queries';
import { catalogueExport } from '@/features/merchants/proposal-queries';

/**
 * docs/16 §6.1 — BioCode's published SKUs as a spreadsheet, for building an offer sheet.
 *
 * ── Why a route handler and not a `data:` URL ──
 *
 * The offers export on the same page is inlined as a `data:` URL, on the reasoning that it is a few
 * kilobytes the page already fetched to render a count. That reasoning does not survive here: the
 * catalogue is every published variant, capped at 5000, and inlining half a megabyte of URL-encoded CSV
 * into the HTML of a dynamic page would make the page slower for everyone who never clicks the link.
 *
 * Under `/api` because that prefix skips localization (`middleware.ts` → `UNLOCALIZED`). A download has no
 * language, and a localized path would need the locale in a URL nobody reads.
 *
 * ── Authorisation is re-checked here ──
 *
 * A route handler is reachable by URL without the portal layout ever rendering, so it repeats the check
 * that layout makes: an approved merchant, or nothing. 404 rather than 403, matching the rest of the
 * portal — a status code should not confirm which URLs exist for people who may not use them.
 *
 * ── What is in it, and what is deliberately not ──
 *
 * Identifiers only: code, barcode, and the two names. **No price and no stock** (owner decision,
 * 2026-08-05). Those columns existed so a merchant could see where BioCode was expensive or short, which
 * is precisely the market intelligence they should not be handed.
 *
 * It does not make prices secret and nothing can — `product_variants` is world-readable for published
 * products, because that is what serves the shop. What it removes is a sorted, machine-readable price
 * list of the entire catalogue, produced on request. Reading prices off a website one at a time and
 * downloading them as a spreadsheet are different activities.
 *
 * The remaining columns are public and this gate is about who we invite to download all of them at once,
 * not about secrecy.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') {
    return new NextResponse(null, { status: 404 });
  }

  const rows = await catalogueExport();

  /*
   * Semicolons and a comma decimal, and a BOM in front.
   *
   * Excel in a comma-decimal locale — which Kosovo is — writes and expects `;` between fields, and opens a
   * comma-separated file as one column per row. The parser accepts commas and tabs too, but the file we
   * hand out should open correctly on the merchant's machine without a dialog.
   */
  const header = ['sku', 'barkod', 'produkti', 'varianti'];
  const quote = (value: string): string => `"${value.replace(/"/g, '""')}"`;

  const csv = [
    header.join(';'),
    ...rows.map((row) =>
      [row.sku, row.barcode, quote(row.productName), quote(row.variantName)].join(';'),
    ),
  ].join('\r\n');

  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="biocode-catalogue.csv"',
      // Per-merchant and per-catalogue-state; a cached copy would hand out yesterday's SKUs.
      'Cache-Control': 'no-store',
    },
  });
}
