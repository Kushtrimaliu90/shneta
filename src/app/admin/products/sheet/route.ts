import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { productExportRows } from '@/features/catalog/sheet-export';
import { buildProductWorkbook } from '@/lib/sheet/product-workbook';
import { MAX_ROWS, readProductWorkbook } from '@/lib/sheet/product-read';
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
    const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Belgrade' }).format(
      new Date(),
    );

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

const TOO_LARGE = 'That file is larger than 8 MB. It is probably not a product sheet.';

const UNREADABLE: Record<string, string> = {
  empty: 'That file is empty.',
  unreadable: 'That file could not be read as a spreadsheet. Save it as .xlsx and try again.',
  no_products_sheet: 'No Products sheet with a header row. Download a fresh copy and edit that.',
  no_rows: 'The file has headers but no rows.',
  too_many_rows: `A sheet in that file has more than ${MAX_ROWS.toLocaleString('en-GB')} rows. Download a fresh copy and edit that.`,
  /*
   * Reached by reordering the tabs so the Variants sheet is first — the positional fallback then reads it as
   * the Products sheet. Without this the operator got seventy identical "No id" lines under a heading saying
   * nothing would change, which describes the file rather than the mistake.
   */
  not_a_product_sheet:
    'The first sheet has no id column, so it is not the Products sheet. Check the tab order, or download a fresh copy.',
  duplicate_headers: 'Two columns share a heading, so one would overwrite the other.',
};

/**
 * The upload, at the same path.
 *
 * ── Why a route and not a Server Action ──
 *
 * A Server Action body is capped at 1 MB and a real workbook is not. So the file posts here as
 * `multipart/form-data`, where the declared length can be refused before the body is buffered.
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

  /*
   * The header first, before `formData()` buffers the body.
   *
   * Checking `file.size` alone would mean reading an eighty-megabyte upload into memory in order to decide
   * it was too big, which is the cost the check exists to avoid. The header can be absent or wrong, so
   * `file.size` is still checked below — this only makes the common case cheap. Same order as the merchant
   * upload route.
   */
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: TOO_LARGE }, { status: 413 });
  }

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ ok: false, error: UNREADABLE.empty }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: TOO_LARGE }, { status: 413 });
    }
    /*
     * The extension, not the MIME type: browsers disagree about what an `.xlsx` is, and Windows has been
     * observed sending `application/octet-stream`. Refusing on the name is a worse test of file *contents*
     * but a much better one of operator *intent* — and it keeps an arbitrary blob out of the parser.
     */
    if (!/\.xlsx$/i.test(file.name)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'That is not an .xlsx file. Download the catalogue, edit that copy, and upload it back.',
        },
        { status: 415 },
      );
    }

    const read = await readProductWorkbook(await file.arrayBuffer());
    if (!read.ok) {
      const base = UNREADABLE[read.reason ?? 'unreadable'] ?? UNREADABLE.unreadable;
      // The repeated names, because "two columns share a heading" is not actionable without them.
      const detail = read.duplicates?.length
        ? ` Rename or delete the extra: ${read.duplicates.join(', ')}.`
        : '';
      return NextResponse.json({ ok: false, error: `${base}${detail}` }, { status: 400 });
    }

    const apply = new URL(request.url).searchParams.get('apply') === '1';
    const plan = await importProducts(read, { apply, actorId: profile.id });

    /*
     * A missing Variants sheet is a notice rather than a refusal — deleting it to edit product fields only is
     * legitimate. But a renamed tab looks identical from here and silently discards every price edit in the
     * file, so it has to be said out loud next to the diff.
     */
    if (read.variantsMissing) {
      plan.problems = [
        {
          sheet: 'Variants',
          row: 0,
          label: 'the whole sheet',
          problem:
            'No Variants sheet was found, so no prices were read. If you renamed the tab, call it "Variants" and upload again.',
        },
        ...plan.problems,
      ];
    }

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
