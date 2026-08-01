import { NextResponse } from 'next/server';
import { requireCapability, audit } from '@/features/admin/audit';
import { exportCustomer } from '@/features/customers/queries';
import { logger } from '@/lib/logger';

/**
 * docs/06 §9 — the GDPR export, as a file download.
 *
 * A route handler rather than a server action because the response is a file: an action returns
 * serialisable data to the client, and turning that into a download means building a Blob in the
 * browser, which puts the customer's whole record into a client bundle for no reason.
 *
 * The capability check is repeated here even though the page that links to it already checked.
 * A URL is reachable without the page — that is the entire threat model for this endpoint, since
 * the id is in the address bar and guessable to anyone who has seen one.
 *
 * `no-store` because the response is one person's personal data and a shared cache anywhere in
 * front of this would be a breach on its own.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const gate = await requireCapability('customers.view');
  if (!gate.ok) {
    // 404, not 403: whether an id exists is itself information, and a content manager probing
    // the endpoint should not learn which ids are real.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const payload = await exportCustomer(id);
    if (!payload) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Audited: reading a customer's whole record is exactly the access that should leave a trace.
    await audit('customer.export', 'profile', id, null, { by: gate.actor.email });

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="customer-${id}.json"`,
        'cache-control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    logger.error('Customer export failed', {
      id,
      cause: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
