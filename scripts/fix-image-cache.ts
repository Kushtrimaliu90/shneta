/**
 * Re-stamps `Cache-Control` on storage objects that were uploaded without it.
 *
 *   pnpm fix:image-cache --dry-run    # list what would change, touch nothing
 *   pnpm fix:image-cache              # re-upload each object with a one-year cache header
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Why this exists
 *
 * Vercel billed 22.8M external API requests and 205 GB of egress on a shop with no customers. A large
 * part of it was the image optimiser: Supabase Storage served every product photograph with
 * `Cache-Control: no-cache`, so Vercel revalidated against the origin instead of serving from its own
 * cache — `X-Vercel-Cache: MISS` on a plain repeat fetch. Every miss is an outbound request to Supabase,
 * a re-run transformation, and the whole image sent to the client again.
 *
 * Every upload site now passes `cacheControl`, and `next.config.ts` sets a `minimumCacheTTL` floor. This
 * script is for the objects already in the bucket, which keep their original header until something
 * rewrites it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * IT DOES NOT CURRENTLY WORK, AND THAT IS WORTH KNOWING
 *
 * Both `upload({ upsert: true, cacheControl })` and `update(path, bytes, { cacheControl })` ran cleanly
 * over all 20 objects and the endpoint still answers `Cache-Control: no-cache`. Checked with a
 * cache-busting query string, so it is the origin and not a CDN copy: **the header is coming from the
 * bucket or the project, not from per-object metadata**, and this API cannot reach it.
 *
 * Left in the repo rather than deleted, for two reasons. It is the fastest way to re-check the origin
 * across the whole bucket — `--dry-run` prints the header every object is actually served with — and it
 * becomes the fix the moment the bucket-level setting is corrected in the Supabase dashboard.
 *
 * **The working fix is `minimumCacheTTL` in `next.config.ts`**, which is a floor Next applies regardless
 * of what the upstream says. That is what stops Vercel revalidating; this would only have made the
 * origin agree.
 *
 * Safe to re-run: it skips anything already carrying a long max-age.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { envFromLocalFile } from '../tests/integration/purge';

/** One year. Every path here is uuid-addressed, so a replacement is a new URL and never a stale hit. */
const CACHE_CONTROL = '31536000';

/** The buckets whose objects are served publicly through `next/image`. */
const BUCKETS = ['product-images'] as const;

interface StorageEntry {
  name: string;
  id: string | null;
}

/**
 * Every object path in a bucket, including nested folders.
 *
 * `list()` is one directory at a time and caps at 100 by default, so this recurses and pages. A flat
 * list would silently cover only the first hundred products, which is the kind of partial fix that
 * looks like it worked.
 */
async function listAll(db: SupabaseClient, bucket: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await db.storage
      .from(bucket)
      .list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });

    if (error) throw new Error(`list ${bucket}/${prefix} failed: ${error.message}`);
    const entries = (data ?? []) as StorageEntry[];
    if (entries.length === 0) break;

    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // A folder comes back with a null id; a file has one.
      if (entry.id === null) found.push(...(await listAll(db, bucket, path)));
      else found.push(path);
    }

    if (entries.length < 100) break;
    offset += entries.length;
  }

  return found;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const env = { ...envFromLocalFile(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!url || !key) {
    console.error('Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let restamped = 0;
  let skipped = 0;
  let failed = 0;

  for (const bucket of BUCKETS) {
    const paths = await listAll(db, bucket);
    console.log(`${bucket}: ${paths.length} object(s)`);

    for (const path of paths) {
      const publicUrl = db.storage.from(bucket).getPublicUrl(path).data.publicUrl;

      /*
       * Asked of the CDN rather than assumed from the metadata, because what matters is the header a
       * client actually receives — that is what Vercel decides on.
       */
      const head = await fetch(publicUrl, { method: 'HEAD' });
      const current = head.headers.get('cache-control') ?? '';
      const maxAge = Number(/max-age=(\d+)/.exec(current)?.[1] ?? 0);

      if (maxAge >= 86_400) {
        skipped += 1;
        continue;
      }

      console.log(`  ${path}  "${current}" → max-age=${CACHE_CONTROL}`);
      if (dryRun) continue;

      const download = await db.storage.from(bucket).download(path);
      if (download.error || !download.data) {
        console.error(`  ✗ ${path}: ${download.error?.message}`);
        failed += 1;
        continue;
      }

      /*
       * `update()`, not `upload({ upsert: true })`.
       *
       * Tried upsert first and the object came back still serving `no-cache` — verified with a
       * cache-busting query string, so it was the object and not a CDN copy. Upsert replaces the bytes
       * and leaves the original metadata; `update` is the call that rewrites it.
       */
      const bytes = Buffer.from(await download.data.arrayBuffer());
      const { error } = await db.storage.from(bucket).update(path, bytes, {
        cacheControl: CACHE_CONTROL,
        contentType: download.data.type || 'image/jpeg',
      });

      if (error) {
        console.error(`  ✗ ${path}: ${error.message}`);
        failed += 1;
        continue;
      }
      restamped += 1;
    }
  }

  console.log(
    `\n${dryRun ? '--dry-run: ' : ''}re-stamped ${restamped} · already cacheable ${skipped} · failed ${failed}`,
  );

  if (!dryRun && restamped > 0) {
    console.log('\nVercel keeps its own copy of what it already fetched, so the saving starts as');
    console.log('its cache turns over. Check `X-Vercel-Cache` on an image in a few minutes:');
    console.log('  curl -sI "https://biocode.fit/_next/image?url=...&w=640&q=75" | grep -i vercel');
  }
}

main().catch((error: unknown) => {
  console.error(`\nfix:image-cache failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
