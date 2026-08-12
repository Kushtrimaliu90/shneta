import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { productExportRows } from '@/features/catalog/sheet-export';
import { buildProductWorkbook } from '@/lib/sheet/product-workbook';
import { readProductWorkbook } from '@/lib/sheet/product-read';
import { importProducts, type ImportPlan } from '@/features/catalog/sheet-import';
import { revalidatePublic } from '@/lib/cache';
import { CACHE_TAGS } from '@/lib/constants';
import { logger, describeError } from '@/lib/logger';

/**
 * The catalogue as a workbook, at `/admin/products/sheet`.
 *
 * ── A route handler, not a Server Action ──
 *
 * An action returns data to a React tree; this returns a file with a `Content-Disposition`, which only a
 * route can do. It is also the natural pair to the upload, which *must* be a route: a Server Action body is
 * capped at 1 MB and a real spreadsheet is not.
 *
 * ── Generated per request, never cached ──
 *
 * Somebody downloads this in order to change something and send it back. A cached copy would mean editing
 * yesterday's prices and uploading them as today's — the one failure this feature must not have, since the
 * file's own edits would look deliberate. `force-dynamic` plus `no-store` on the response.
 *
 * ── Its own capability check ──
 *
 * The admin layout guards `/admin/*` pages, and a route handler is not a page: it does not render inside
 * that layout and inherits nothing from it. So the check is here, on `products.manage`, the same capability
 * the list and the editor require. Reading it through the operator's own session means RLS applies as well.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const profile = await getProfile();
  if (!can(profile?.role, 'products.manage')) {
    /*
     * 404 rather than 403. Someone without the capability learns nothing about whether the export exists,
     * which is the same answer the admin layout gives a merchant who guesses at a URL.
     */
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  try {
    const { products, variants } = await productExportRows();
    const workbook = await buildProductWorkbook(products, variants);

    /*
     * The date in the filename, because the first thing that happens to this file is that it gets edited
     * and sent back — and the second is that somebody finds three of them in Downloads. Europe/Belgrade,
     * matching every other date the panel shows.
     */
    const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Belgrade' }).format(new Date());

    return new NextResponse(workbook, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="biocode-products-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error('product sheet export failed', describeError(error));
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

/** Beyond this it is not an edit of a seventy-product catalogue. Checked before parsing anything. */
const MAX_BYTES = 8 * 1024 * 1024;

const UNREADABLE: Record<string, string> = {
  empty: 'That file is empty.',
  unreadable: 'That file could not be read as a spreadsheet. Save it as .xlsx and try again.',
  no_products_sheet: 'No Products sheet with a header row. Download a fresh copy and edit that.',
  no_rows: 'The file has headers but no rows.',
  too_many_rows: 'That file has more rows than this catalogue has products.',
};

/**
 * The upload, at the same path.
 *
 * ── Why a route and not a Server Action ──
 *
 * A Server Action body is capped at 1 MB and a real workbook is not. So the file posts here as
 * `multipart/form-data`, which is also what lets the size be refused before anything is parsed.
 *
 * ── Preview, then apply, from the same file ──
 *
 * `?apply=1` writes; without it the same call computes the same plan and returns it unwritten. The client
 * posts the file twice — once to show the diff, once to confirm — and **nothing is carried between the two
 * requests**. That is the important part: the second request re-reads the file and re-diffs it against
 * current data, so a plan cannot be applied against a catalogue that has moved on, and a posted diff cannot
 * be tampered with because there is no posted diff.
 *
 * The cost is parsing twice, which for seventy rows is milliseconds.
 */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!can(profile?.role, 'products.manage') || !profile) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ ok: false, error: UNREADABLE.empty }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: 'That file is larger than 8 MB. It is probably not a product sheet.' },
        { status: 400 },
      );
    }

    const read = await readProductWorkbook(await file.arrayBuffer());
    if (!read.ok) {
      return NextResponse.json(
        { ok: false, error: UNREADABLE[read.reason ?? 'unreadable'] ?? UNREADABLE.unreadable },
        { status: 400 },
      );
    }

    const apply = new URL(request.url).searchParams.get('apply') === '1';
    const plan = await importProducts(read, { apply, actorId: profile.id });

    /*
     * Purged only after a real write, and broadly.
     *
     * A sheet can touch a name, a price, a category and a brand in one go, so working out the minimal tag
     * set per row is the kind of cleverness that eventually serves a stale price. `revalidatePath` for the
     * list as well, since the operator lands back on it.
     */
    if (apply && plan.applied) {
      const touched = (plan as ImportPlan & { touchedSlugs?: string[] }).touchedSlugs ?? [];
      revalidatePublic([
        CACHE_TAGS.products,
        CACHE_TAGS.categories,
        CACHE_TAGS.brands,
        CACHE_TAGS.goals,
        ...touched.map((slug) => CACHE_TAGS.product(slug)),
      ]);
      revalidatePath('/admin/products');
    }

    return NextResponse.json({ ok: true, plan }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logger.error('product sheet import failed', describeError(error));
    return NextResponse.json({ ok: false, error: UNREADABLE.unreadable }, { status: 500 });
  }
}
