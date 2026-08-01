import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * docs/05 §14 — the address book.
 *
 * Named in M5's account nav and never built until now (docs/14 §10). Everything here goes through
 * the SSR client and `p_own on addresses`, which scopes both reads and writes to `auth.uid()` —
 * so there is no ownership check in this file or in the actions, and a forged id updates zero
 * rows instead of somebody else's address.
 */

export interface AddressRow {
  id: string;
  label: string | null;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string | null;
  countryCode: string;
  phone: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
}

export async function listAddresses(): Promise<AddressRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('addresses')
    .select(
      `id, label, recipient_name, line1, line2, city, postal_code, country_code, phone,
       is_default_shipping, is_default_billing`,
    )
    .order('is_default_shipping', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('listAddresses failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    recipientName: row.recipient_name,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    phone: row.phone,
    isDefaultShipping: row.is_default_shipping,
    isDefaultBilling: row.is_default_billing,
  }));
}
