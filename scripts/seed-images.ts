/**
 * Uploads product photography and registers it (docs/11 §10, docs/14 §20).
 *
 *   pnpm seed:images ./photos              # upload every image, matched to products by filename
 *   pnpm seed:images ./photos --dry-run    # say what would happen, touch nothing
 *   pnpm seed:images ./photos --replace    # remove a product's existing images first
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Why this script exists
 *
 * `docs/11 §10` has specified it since M2 and it was never written, which is why every one of the
 * 63 published products renders the branded fallback tile instead of a photograph. It is also the
 * one thing standing between the catalogue and a real launch: migration 14 makes an image a
 * **precondition of publishing** (docs/14 §8), so a product created in the admin panel cannot go
 * live without one. The seeded products are published only because the service role is exempt.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Matched by filename, like the merchant uploader
 *
 * `now-vitamin-d3-4000.jpg` finds the product with that slug. `now-vitamin-d3-4000-2.jpg` is its
 * second image, and the trailing counter sets `position`. The same convention as batch proposals
 * (docs/16 §9.1) and for the same reason: a folder of photographs named after what is in them is
 * what a photographer hands over, and any other scheme means somebody retyping 63 filenames.
 *
 * Unmatched files are **listed and skipped**, never guessed at. A photograph on the wrong product
 * page is worse than a missing one, because nobody checks a page that looks finished.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * On where the files come from
 *
 * Not from another retailer's website. Product photography is copyrighted by whoever shot it, and a
 * shop that lifts it is one takedown notice away from empty product pages — on the pages that earn
 * the money. The two lawful sources are the manufacturer's own dealer assets (NOW Foods, Solgar,
 * Optimum Nutrition and the rest all run asset portals for stockists) and a camera pointed at the
 * stock on your own shelf. This script does not care which; it only cares that the files are yours
 * to use.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { envFromLocalFile } from '../tests/integration/purge';

const ACCEPTED = new Map([
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.avif', 'image/avif'],
]);

/** Two megabytes, matching what the product editor accepts from a browser. */
const MAX_BYTES = 2 * 1024 * 1024;

interface Candidate {
  file: string;
  slug: string;
  position: number;
  bytes: Buffer;
  contentType: string;
}

/**
 * Reads `<slug>[-<n>].<ext>` out of a filename.
 *
 * The counter is one or two digits and only counts as a counter when the rest still matches a
 * product — `vitamin-b12-1000` is a slug, not `vitamin-b12` image 1000. Deciding that here rather
 * than by regex alone is why the product slugs are passed in.
 */
function parseName(file: string, slugs: Set<string>): { slug: string; position: number } | null {
  const raw = basename(file, extname(file)).toLowerCase();

  /*
   * Underscores count as hyphens.
   *
   * `on_bcaa_1000.jpg` is the product `on-bcaa-1000`, and that is not a typo worth bouncing a file over:
   * phone cameras, Windows renames and half the export dialogs in existence produce underscores, and a
   * photographer handed a list of hyphenated slugs will still send some of both. Tried as a *fallback*
   * after the literal stem, so a slug that genuinely contains an underscore — none do today — would
   * still win on its own name.
   */
  for (const stem of raw.includes('_') ? [raw, raw.replace(/_/g, '-')] : [raw]) {
    if (slugs.has(stem)) return { slug: stem, position: 0 };

    const match = /^(.*)[-_](\d{1,2})$/.exec(stem);
    if (match && match[1] && slugs.has(match[1])) {
      return { slug: match[1], position: Number(match[2]) - 1 };
    }
  }

  return null;
}

/**
 * Prints the filename every product without a photograph is waiting for.
 *
 * This is the shot list. Automated retrieval of official packshots is not available — the
 * manufacturers' sites answer a scripted request with 403, which is what a licensed asset library is
 * supposed to do — so the photographs come from a brand's dealer portal or from a camera, and either
 * way somebody needs to know exactly what is missing and what to call it.
 *
 * Emitted as CSV so it can go straight to a distributor or a photographer.
 */
async function manifest(db: SupabaseClient): Promise<void> {
  const { data, error } = await db
    .from('products')
    .select('slug, name, status, brands ( name ), product_images ( id )')
    .is('deleted_at', null)
    .order('slug');

  if (error) {
    console.error(`Could not read products: ${error.message}`);
    process.exit(1);
  }

  const rows = (data ?? []) as unknown as {
    slug: string;
    name: Record<string, string>;
    status: string;
    brands: { name: string } | null;
    product_images: { id: string }[];
  }[];

  const missing = rows.filter((row) => (row.product_images ?? []).length === 0);

  console.log('filename,brand,product,status');
  for (const row of missing) {
    const product = (row.name.en ?? row.name.sq ?? '').replace(/"/g, '""');
    console.log(`${row.slug}.jpg,"${row.brands?.name ?? ''}","${product}",${row.status}`);
  }

  console.log(
    `\n# ${missing.length} of ${rows.length} product(s) have no photograph.`,
  );
  console.log('# Name each file after the slug in column one. A second shot of the same product is');
  console.log('# <slug>-2.jpg, a third <slug>-3.jpg. Then: pnpm seed:images ./photos');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const folder = args.find((arg) => !arg.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const replace = args.includes('--replace');
  const wantManifest = args.includes('--manifest');

  if (!folder && !wantManifest) {
    console.error('Usage: pnpm seed:images <folder> [--dry-run] [--replace]');
    console.error('       pnpm seed:images --manifest     # list the filenames still needed');
    process.exit(1);
  }

  const env = { ...envFromLocalFile(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!url || !key) {
    console.error('Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  /*
   * No `assertPurgeable` here, deliberately — unlike the purge and `seed:users`, this script is
   * **meant** to run against production: that is where the real photography goes. It writes only
   * images and image rows, and `--replace` is the one destructive flag, scoped to the products it
   * has files for.
   */
  const db: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (wantManifest) {
    await manifest(db);
    return;
  }

  // Narrowed for the compiler: the usage check above already refused a run with neither.
  if (!folder) return;

  const { data: products, error } = await db
    .from('products')
    .select('id, slug')
    .is('deleted_at', null);

  if (error) {
    console.error(`Could not read products: ${error.message}`);
    process.exit(1);
  }

  const bySlug = new Map(((products ?? []) as { id: string; slug: string }[]).map((p) => [p.slug, p.id]));
  const slugs = new Set(bySlug.keys());

  const files = readdirSync(folder).filter((file) => ACCEPTED.has(extname(file).toLowerCase()));
  if (files.length === 0) {
    console.error(`No images in ${folder}. Accepted: ${[...ACCEPTED.keys()].join(', ')}`);
    process.exit(1);
  }

  const candidates: Candidate[] = [];
  const unmatched: string[] = [];
  const oversized: string[] = [];

  for (const file of files) {
    const parsed = parseName(file, slugs);
    if (!parsed) {
      unmatched.push(file);
      continue;
    }

    const path = join(folder, file);
    if (statSync(path).size > MAX_BYTES) {
      oversized.push(file);
      continue;
    }

    candidates.push({
      file,
      slug: parsed.slug,
      position: parsed.position,
      bytes: readFileSync(path),
      contentType: ACCEPTED.get(extname(file).toLowerCase()) ?? 'image/jpeg',
    });
  }

  console.log(`${files.length} image(s) in ${folder}`);
  console.log(`  matched to a product: ${candidates.length}`);
  if (unmatched.length > 0) {
    console.log(`  unmatched (skipped):  ${unmatched.length}`);
    for (const file of unmatched.slice(0, 20)) console.log(`      ${file}`);
    if (unmatched.length > 20) console.log(`      … and ${unmatched.length - 20} more`);
    console.log('    Rename these after the product slug — see /admin/products for the slugs.');
  }
  if (oversized.length > 0) {
    console.log(`  over 2 MB (skipped):  ${oversized.join(', ')}`);
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing was uploaded.');
    return;
  }

  /*
   * Which products already have a photograph, so a first shot is not added twice.
   *
   * The product editor uploads to `${productId}/${uuid}.${ext}` and this script to
   * `${productId}/${slug}.${ext}`, so the same photograph under two names is two rows and the gallery
   * renders it twice — the unique index cannot see it, because the paths genuinely differ.
   *
   * It happened: nine images were added through the Media tab, then the same folder was run through
   * here forty minutes later. Neither party did anything wrong, which is why the tool has to be the one
   * that notices. A **position-0** file is skipped when the product already has an image; `--replace`
   * says overwrite, and `<slug>-2.jpg` is an intentional second shot and always proceeds.
   */
  const { data: existingRows } = await db.from('product_images').select('product_id');
  const alreadyHasImage = new Set(
    ((existingRows ?? []) as { product_id: string }[]).map((row) => row.product_id),
  );

  let uploaded = 0;
  let failed = 0;
  let skippedExisting = 0;
  const touched = new Set<string>();

  for (const candidate of candidates) {
    const productId = bySlug.get(candidate.slug);
    if (!productId) continue;

    if (candidate.position === 0 && !replace && alreadyHasImage.has(productId)) {
      console.log(`  – ${candidate.file}: ${candidate.slug} already has an image (--replace to overwrite)`);
      skippedExisting += 1;
      continue;
    }

    /*
     * `--replace` clears first, once per product rather than once per file — otherwise the second
     * image of a product would delete the first one this run just uploaded.
     */
    if (replace && !touched.has(productId)) {
      const { data: existing } = await db
        .from('product_images')
        .select('storage_path')
        .eq('product_id', productId);

      const paths = ((existing ?? []) as { storage_path: string }[]).map((row) => row.storage_path);
      if (paths.length > 0) {
        await db.storage.from('product-images').remove(paths);
        await db.from('product_images').delete().eq('product_id', productId);
      }
    }
    touched.add(productId);

    /*
     * `<product_id>/<file>` — the path the product editor signs for its own uploads and the one the
     * proposal promotion writes (docs/13 §X16). One convention in the bucket.
     */
    const target = `${productId}/${candidate.file.toLowerCase()}`;

    const { error: uploadError } = await db.storage
      .from('product-images')
      .upload(target, candidate.bytes, { contentType: candidate.contentType, upsert: true });

    if (uploadError) {
      console.error(`  ✗ ${candidate.file}: ${uploadError.message}`);
      failed += 1;
      continue;
    }

    /*
     * Alt text is left empty on purpose. It describes what is *in* the photograph and only a person
     * looking at it can write it — the product editor has the field. A generated "Product name" alt
     * is worse than none: it passes the accessibility check while telling a screen-reader user
     * nothing they had not already heard from the heading.
     */
    const { error: rowError } = await db.from('product_images').upsert(
      {
        product_id: productId,
        storage_path: target,
        alt: {},
        position: candidate.position,
      },
      { onConflict: 'product_id,storage_path' },
    );

    if (rowError) {
      console.error(`  ✗ ${candidate.file} row: ${rowError.message}`);
      failed += 1;
      continue;
    }

    uploaded += 1;
  }

  console.log(
    `\nuploaded ${uploaded} · failed ${failed} · already had one ${skippedExisting} · products touched ${touched.size}`,
  );

  const { count: withImages } = await db
    .from('product_images')
    .select('product_id', { count: 'exact', head: true });
  const { count: published } = await db
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published');

  console.log(`product_images rows now: ${withImages ?? 0} · published products: ${published ?? 0}`);
  console.log('\nRemember to purge the cache so the storefront picks them up:');
  console.log('  curl -X POST "$NEXT_PUBLIC_SITE_URL/api/revalidate" \\');
  console.log('    -H "x-revalidate-secret: $REVALIDATE_SECRET" -d \'{"tag":"products"}\'');
}

main().catch((error: unknown) => {
  console.error(`\nseed:images failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
