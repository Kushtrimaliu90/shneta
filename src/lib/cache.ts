import 'server-only';
import { revalidateTag } from 'next/cache';
import { logger } from '@/lib/logger';

/**
 * docs/02 §5 — on-demand ISR purging.
 *
 * Server-only and in its own module rather than in `lib/utils.ts`: `next/cache` must never
 * be pulled into a client bundle, and `utils.ts` exports `cn()`, which nearly every client
 * component imports.
 *
 * The tag vocabulary is closed — see `CACHE_TAGS` in lib/constants.ts. Every admin mutation
 * that touches public content calls this for the tags it affected.
 */
export function revalidatePublic(tags: readonly string[]): void {
  for (const tag of tags) {
    revalidateTag(tag);
  }
  logger.info('Revalidated cache tags', { tags });
}
