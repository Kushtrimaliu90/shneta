import { clientEnv } from '@/lib/env.client';

/**
 * The public URL for an object in a Supabase Storage bucket.
 *
 * Extracted because the hero needed the same construction `ProductImage` had inlined, and two copies
 * of a URL shape is how one of them ends up pointing at the wrong bucket. Safe in a client component:
 * it reads only `NEXT_PUBLIC_SUPABASE_URL`, which is public by definition.
 *
 * Buckets are public-read but write-guarded by policy, so a URL from here is safe to render and
 * confers nothing — uploading still requires a role (docs/02 §6).
 */
export function storageUrl(bucket: string, path: string): string {
  return `${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}
