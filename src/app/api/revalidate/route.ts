import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { CACHE_TAGS } from '@/lib/constants';
import { revalidatePublic } from '@/lib/cache';
import { requireEnv } from '@/lib/env.server';
import { logger } from '@/lib/logger';

/**
 * docs/02 §4 — secret-guarded on-demand ISR purge.
 *
 * Admin mutations call `revalidatePublic()` directly in-process; this endpoint is the
 * out-of-band escape hatch, for when content is changed outside the app (a corrected
 * translation applied by SQL, say) and the cache needs to be told.
 */

/**
 * The tag vocabulary is closed (docs/02 §5). `CACHE_TAGS` mixes literals with builder
 * functions, so the literals are collected here and the parameterised ones are validated
 * by shape below.
 */
const STATIC_TAGS: ReadonlySet<string> = new Set(
  Object.values(CACHE_TAGS).flatMap((value) => (typeof value === 'string' ? [value] : [])),
);
const PREFIXED_TAG = /^(product|brand|ingredient|article):[a-z0-9-]{1,96}$/;

const schema = z.object({
  tags: z.array(z.string().min(1).max(128)).min(1).max(50),
});

export async function POST(request: NextRequest) {
  let secret: string;
  try {
    secret = requireEnv('REVALIDATE_SECRET', 'the on-demand revalidation endpoint');
  } catch {
    // Absent secret means the endpoint is not in use — refuse rather than run unguarded.
    return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 });
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  // Reject unknown tags loudly. Silently accepting a typo'd tag is worse than an error:
  // the caller believes the cache was purged when nothing happened.
  const unknown = parsed.data.tags.filter(
    (tag) => !STATIC_TAGS.has(tag) && !PREFIXED_TAG.test(tag),
  );
  if (unknown.length > 0) {
    return NextResponse.json({ error: 'UNKNOWN_TAGS', unknown }, { status: 400 });
  }

  revalidatePublic(parsed.data.tags);
  logger.info('On-demand revalidation', { tags: parsed.data.tags });

  return NextResponse.json({ ok: true, revalidated: parsed.data.tags });
}
