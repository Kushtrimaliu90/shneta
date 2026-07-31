import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/features/auth/schemas';
import { logger } from '@/lib/logger';

/**
 * Exchanges the code from a Supabase email link (verification, password recovery, invite)
 * for a session, then forwards the user on.
 *
 * Lives under `/api` on purpose: `/auth/*` is inside the localized tree, so a callback
 * there would be rewritten to `/sq/auth/callback` and the URL registered with Supabase
 * would have to encode a locale. This path is excluded from the intl middleware, so one
 * redirect URL works for both locales.
 *
 * Register it in the Supabase dashboard under Auth → URL Configuration:
 *   {SITE_URL}/api/auth/callback
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'), '/account');

  // Supabase reports link failures (expired, already used) on the query string.
  const errorCode = searchParams.get('error') ?? searchParams.get('error_code');
  if (errorCode) {
    logger.info('Auth callback returned an error', { errorCode });
    return NextResponse.redirect(`${origin}/auth/sign-in?error=link_invalid`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/sign-in?error=link_invalid`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    logger.info('Code exchange failed', { reason: error.message });
    return NextResponse.redirect(`${origin}/auth/sign-in?error=link_invalid`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
