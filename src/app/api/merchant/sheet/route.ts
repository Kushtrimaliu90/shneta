import { NextResponse, type NextRequest } from 'next/server';
import { readSheet } from '@/lib/sheet/read';
import { getMyMerchant } from '@/features/merchants/queries';
import { logger } from '@/lib/logger';

/**
 * Turns an uploaded `.xlsx` or `.csv` into the delimited text the bulk forms already understand.
 *
 * ── Why a route handler and not a Server Action ──
 *
 * A Server Action body is capped at 1 MB. A real spreadsheet is not, and the whole point of this work is
 * that the merchant hands over the file they already have rather than converting it. A route handler
 * takes `multipart/form-data` at whatever size the platform allows, so the cap stops being the reason a
 * merchant cannot use the feature.
 *
 * It reads and returns; it writes nothing. The existing action still performs the update, with the same
 * validation, the same caps and the same RLS — this only replaces "know how to make a CSV" with "pick
 * your file". That separation is deliberate: a parser reachable over HTTP that could also write would be
 * a second, less-tested path to the same tables.
 */
export const dynamic = 'force-dynamic';

/** Enough for a 5000-row sheet with formatting; past this it is not a stock update. */
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') {
    // 404 rather than 403: whether an approved merchant account exists is not this endpoint's to reveal.
    return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 404 });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BYTES) {
    return NextResponse.json({ ok: false, reason: 'too_large' }, { status: 413 });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get('file');
    if (value instanceof File) file = value;
  } catch {
    return NextResponse.json({ ok: false, reason: 'unreadable' }, { status: 400 });
  }

  if (!file) return NextResponse.json({ ok: false, reason: 'empty' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, reason: 'too_large' }, { status: 413 });
  }

  /*
   * Extension, not MIME type. Browsers disagree about what an `.xlsx` is — Chrome says the OOXML type,
   * some Windows setups say `application/octet-stream`, and a file dragged from an email attachment can
   * arrive with no type at all. The reader distinguishes the two formats itself and fails closed.
   */
  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    return NextResponse.json({ ok: false, reason: 'wrong_type' }, { status: 415 });
  }

  const result = await readSheet(await file.arrayBuffer(), file.name);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason ?? 'unreadable' }, { status: 422 });
  }

  logger.info('merchant sheet read', {
    merchantId: merchant.id,
    rows: result.rowCount,
    kind: /\.csv$/i.test(file.name) ? 'csv' : 'xlsx',
  });

  return NextResponse.json({ ok: true, text: result.text, rowCount: result.rowCount });
}
