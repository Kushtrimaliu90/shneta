import { NextResponse } from 'next/server';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { createClient } from '@/lib/supabase/server';
import { signedDocumentUrl } from '@/features/merchants/admin-queries';
import { logger } from '@/lib/logger';

/**
 * docs/16 §4 — opening one KYB document.
 *
 * A redirect to a short-lived signed URL rather than a link rendered into the page.
 *
 * The bucket is private, so a link has to be signed — and signing every document on every render
 * would mint URLs for documents nobody opens, each one valid for as long as its expiry, sitting in
 * the HTML of a page that gets left open. Signing on the click means one URL exists per view, and it
 * expires in five minutes whether or not the reviewer used it.
 *
 * The capability is re-checked here because a route handler is reachable by URL without ever
 * rendering the page that links to it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const profile = await getProfile();
  if (!can(profile?.role, 'merchants.view')) {
    // 404 rather than 403: this is an identity document, and confirming it exists is information.
    return new NextResponse(null, { status: 404 });
  }

  const { id } = await params;

  const supabase = await createClient();
  const { data } = await supabase
    .from('merchant_documents')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();

  const path = (data as { storage_path: string } | null)?.storage_path;
  if (!path) return new NextResponse(null, { status: 404 });

  const url = await signedDocumentUrl(path);
  if (!url) {
    logger.error('merchant document could not be signed', { documentId: id });
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(url);
}
