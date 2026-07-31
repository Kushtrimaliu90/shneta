import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * docs/10 §6 — the uptime monitor pings this every minute.
 *
 * It reads through the **anon** client on purpose. A service-role `select 1` would prove
 * only that Postgres is up; this proves the path customers actually use is up — network,
 * PostgREST, and RLS all working. `settings` is world-readable by policy, so a healthy
 * response means an anonymous visitor can really read public data.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const startedAt = Date.now();

  try {
    const supabase = await createClient();
    const { error } = await supabase.from('settings').select('key').limit(1);

    if (error) {
      logger.error('Health check failed at the database', { cause: error.message });
      return NextResponse.json(
        { status: 'degraded', database: 'error', latencyMs: Date.now() - startedAt },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      {
        status: 'ok',
        database: 'ok',
        latencyMs: Date.now() - startedAt,
        // Set by Vercel; useful for confirming which build answered.
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    logger.error('Health check threw', {
      cause: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { status: 'down', latencyMs: Date.now() - startedAt },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
