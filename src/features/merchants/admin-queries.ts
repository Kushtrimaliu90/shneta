import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * docs/16 §11 — the reads behind `/admin/merchants*`.
 *
 * SSR client, so the staff-read policies apply to the people they were written for. The service
 * client is used only where an applicant has no session at all (`actions.ts`).
 */

export type MerchantStatus = 'pending' | 'approved' | 'suspended' | 'rejected';

export interface MerchantRow {
  id: string;
  slug: string;
  legalName: string;
  displayName: string;
  businessNo: string;
  vatNo: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: Record<string, unknown>;
  status: MerchantStatus;
  commissionPct: number;
  shippingBorneBy: 'biocode' | 'merchant' | 'customer' | null;
  shipsOwn: boolean;
  collectsCash: boolean;
  bankName: string | null;
  ibanLast4: string | null;
  settlementMethod: 'bank_transfer' | 'cash';
  applicationNote: string | null;
  reviewerNote: string | null;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  createdAt: string;
  approvedAt: string | null;
  /** Enough to answer "can this be approved yet?" without a second query. */
  documents: { id: string; kind: string; verified: boolean; storagePath: string }[];
  offerCount: number;
  ownerEmails: string[];
}

/**
 * Applications and merchants, by status.
 *
 * The **IBAN is never returned in full** — only the last four digits. The review screen needs to
 * show that a bank account was given and to distinguish one from another; it does not need to put
 * the whole number on a page that will be screenshotted into a group chat. The full value lives in
 * the row for the payout run to read.
 */
export async function listMerchants(status?: MerchantStatus): Promise<MerchantRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from('merchants')
    .select(
      `id, slug, legal_name, display_name, business_no, vat_no,
       contact_name, contact_email, contact_phone, address, status,
       commission_pct, shipping_borne_by, ships_own, collects_cash,
       bank_name, iban, settlement_method, application_note, rejection_note,
       terms_version, terms_accepted_at, created_at, approved_at,
       merchant_documents ( id, kind, verified, storage_path ),
       merchant_offers ( id ),
       merchant_users ( profiles ( email ) )`,
    )
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    logger.error('listMerchants failed', { cause: error.message });
    return [];
  }

  type Raw = {
    id: string;
    slug: string;
    legal_name: string;
    display_name: string;
    business_no: string;
    vat_no: string | null;
    contact_name: string;
    contact_email: string;
    contact_phone: string;
    address: Record<string, unknown> | null;
    status: MerchantStatus;
    commission_pct: number;
    shipping_borne_by: MerchantRow['shippingBorneBy'];
    ships_own: boolean;
    collects_cash: boolean;
    bank_name: string | null;
    iban: string | null;
    settlement_method: string | null;
    application_note: string | null;
    rejection_note: string | null;
    terms_version: string | null;
    terms_accepted_at: string | null;
    created_at: string;
    approved_at: string | null;
    merchant_documents: { id: string; kind: string; verified: boolean; storage_path: string }[];
    merchant_offers: { id: string }[];
    merchant_users: { profiles: { email: string } | null }[];
  };

  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    legalName: row.legal_name,
    displayName: row.display_name,
    businessNo: row.business_no,
    vatNo: row.vat_no,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    address: row.address ?? {},
    status: row.status,
    commissionPct: Number(row.commission_pct),
    shippingBorneBy: row.shipping_borne_by,
    shipsOwn: row.ships_own,
    collectsCash: row.collects_cash,
    bankName: row.bank_name,
    ibanLast4: row.iban ? row.iban.slice(-4) : null,
    settlementMethod: row.settlement_method === 'cash' ? 'cash' : 'bank_transfer',
    applicationNote: row.application_note,
    reviewerNote: row.rejection_note,
    termsVersion: row.terms_version,
    termsAcceptedAt: row.terms_accepted_at,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    documents: (row.merchant_documents ?? []).map((doc) => ({
      id: doc.id,
      kind: doc.kind,
      verified: doc.verified,
      storagePath: doc.storage_path,
    })),
    offerCount: (row.merchant_offers ?? []).length,
    ownerEmails: (row.merchant_users ?? [])
      .map((link) => link.profiles?.email)
      .filter((email): email is string => Boolean(email)),
  }));
}

/**
 * A signed URL for one KYB document.
 *
 * The bucket is private, so this is the only way a reviewer sees a registration certificate. Five
 * minutes, because the link is generated on a click and used immediately — a long-lived URL to an
 * identity document is the private bucket undone by convenience.
 */
export async function signedDocumentUrl(storagePath: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from('merchant-docs')
    .createSignedUrl(storagePath, 300);

  if (error) {
    logger.error('signedDocumentUrl failed', { cause: error.message });
    return null;
  }
  return data?.signedUrl ?? null;
}

/** Counts for the queue chips and the admin dashboard. */
export async function merchantCounts(): Promise<Record<MerchantStatus, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('merchants').select('status');

  const counts: Record<MerchantStatus, number> = {
    pending: 0,
    approved: 0,
    suspended: 0,
    rejected: 0,
  };

  if (error) {
    logger.error('merchantCounts failed', { cause: error.message });
    return counts;
  }

  for (const row of (data ?? []) as { status: MerchantStatus }[]) {
    counts[row.status] += 1;
  }
  return counts;
}
