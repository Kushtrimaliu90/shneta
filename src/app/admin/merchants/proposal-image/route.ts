import { NextResponse, type NextRequest } from 'next/server';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { signProposalImage } from '@/features/merchants/proposal-promote';
import { logger } from '@/lib/logger';

/**
 * docs/16 §9 — serving one proposal photograph to a reviewer.
 *
 * A redirect to a short-lived signed URL, the same shape as the KYB documents (§4) and for the same
 * reason: the bucket is private, so a thumbnail has to be signed, and signing every image of every
 * proposal at render time would mint URLs for photographs nobody looks at — each valid for its whole
 * expiry, sitting in the HTML of a queue somebody leaves open all afternoon.
 *
 * The path arrives as a query parameter rather than a route segment because it contains slashes, and a
 * catch-all segment would decode them into a shape that no longer matches what is stored.
 *
 * ── The check that matters ──
 *
 * `offers.review` is re-checked here because a route handler is reachable by URL without ever rendering
 * the page that links to it. And the path is **constrained to the proposals prefix**: without that, this
 * would be a signing oracle for any object in the bucket to anyone holding the capability — which is
 * narrower than it sounds, but a handler that will sign whatever it is handed is the wrong shape.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const profile = await getProfile();
  if (!can(profile?.role, 'offers.review')) {
    return new NextResponse(null, { status: 404 });
  }

  const path = request.nextUrl.searchParams.get('path') ?? '';

  if (!path.startsWith('proposals/') || path.includes('..')) {
    return new NextResponse(null, { status: 404 });
  }

  const url = await signProposalImage(path);
  if (!url) {
    logger.error('proposal image could not be signed', { path });
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(url);
}
