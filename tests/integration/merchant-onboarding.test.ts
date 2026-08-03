import { afterAll, describe, expect, it } from 'vitest';
import { createUser, deleteUser, serviceClient } from './helpers';
import {
  merchantApplicationSchema,
  slugFromName,
} from '@/features/merchants/schemas';

/**
 * docs/16 §4 — onboarding and the admin decision.
 *
 * The server actions themselves cannot run here: they are `'use server'` modules that read
 * `headers()` and `revalidatePath()`, neither of which exists outside a request. So this suite
 * exercises the two halves that carry the risk and can be tested honestly — the **schema** that
 * decides what an application may contain, and the **database transitions** an approval performs —
 * against the real tables and the real RLS.
 *
 * The click-through path is E2E's job (step 9).
 */

const created: string[] = [];
const merchants: string[] = [];

afterAll(async () => {
  const db = serviceClient();
  for (const id of merchants) await db.from('merchants').delete().eq('id', id);
  for (const id of created) await deleteUser(id);
});

/** A complete application, as the form would post it — every value a string. */
function application(over: Record<string, string> = {}): Record<string, string> {
  return {
    legalName: 'Alpha Supplements SH.P.K.',
    displayName: 'Alpha Supplements',
    businessNo: '811234567',
    vatNo: '',
    contactName: 'Arta Krasniqi',
    contactEmail: `alpha-${Date.now()}@biocode.test`,
    contactPhone: '+383 44 123 456',
    addressLine: 'Rr. Agim Ramadani 12',
    city: 'Prishtinë',
    postalCode: '10000',
    bankName: 'BKT',
    iban: 'XK05 1000 0000 0000 0000',
    categories: 'Vitamins, minerals, sports nutrition',
    catalogSize: '40',
    acceptsTerms: 'on',
    acceptsCommission: 'on',
    ...over,
  };
}

describe('the application schema (docs/16 §4)', () => {
  it('accepts a complete application', () => {
    const result = merchantApplicationSchema.safeParse(application());
    expect(result.success).toBe(true);
  });

  /**
   * An unchecked checkbox is absent from the FormData entirely, and this is the assertion that keeps
   * the acceptance real. `z.coerce.boolean()` would turn `undefined` into `false` and pass — the
   * merchant would be recorded as having accepted terms they never ticked.
   */
  it('refuses an application with the terms unchecked', () => {
    const { acceptsTerms: _omitted, ...withoutTerms } = application();
    expect(merchantApplicationSchema.safeParse(withoutTerms).success).toBe(false);
  });

  it('refuses an application with the commission unacknowledged', () => {
    const { acceptsCommission: _omitted, ...without } = application();
    expect(merchantApplicationSchema.safeParse(without).success).toBe(false);
  });

  /**
   * IBANs are typed with spaces by every human who has ever typed one.
   *
   * Twenty characters, which is a Kosovo IBAN: `XK05` plus sixteen digits. The first version of this
   * assertion expected twenty-one — my own miscount, not the schema's — and the failure was the test
   * being wrong rather than the code.
   */
  it('normalises an IBAN written with spaces and lower case', () => {
    const result = merchantApplicationSchema.safeParse(
      application({ iban: 'xk05 1000 0000 0000 0000' }),
    );
    expect(result.success && result.data.iban).toBe('XK051000000000000000');
  });

  it('refuses a phone number in the IBAN field', () => {
    expect(merchantApplicationSchema.safeParse(application({ iban: '+383 44 123 456' })).success)
      .toBe(false);
  });

  it('lowercases the contact email, since it is the invite address', () => {
    const result = merchantApplicationSchema.safeParse(
      application({ contactEmail: 'Arta@BioCode.Test' }),
    );
    expect(result.success && result.data.contactEmail).toBe('arta@biocode.test');
  });

  it('refuses a business number that is obviously a phone number', () => {
    expect(merchantApplicationSchema.safeParse(application({ businessNo: '+383 44 1' })).success)
      .toBe(false);
  });
});

describe('slugFromName', () => {
  it('strips Albanian diacritics rather than dropping the letter', () => {
    // "Përparim" must not become "prparim" — a missing letter reads as a typo in a URL.
    expect(slugFromName('Përparim Sh.p.k.')).toBe('perparim-sh-p-k');
  });

  it('collapses punctuation and trims the edges', () => {
    expect(slugFromName('  Alpha & Beta — Supplements!  ')).toBe('alpha-beta-supplements');
  });

  /** A name with nothing usable in it still has to produce a valid slug. */
  it('falls back rather than returning an empty string', () => {
    expect(slugFromName('!!!')).toBe('merchant');
  });
});

describe('the approval transition (docs/16 §4)', () => {
  /**
   * What approval must actually change, asserted against the database rather than through the action.
   *
   * The commission and the shipping arrangement are the point: a merchant going live without them
   * decided is the failure this screen exists to prevent, and `merchant_settlement` reads both.
   */
  it('records the commercial terms and makes the merchant live', async () => {
    const db = serviceClient();
    const admin = await createUser('admin');
    created.push(admin.id);

    const { data: pending } = await db
      .from('merchants')
      .insert({
        slug: `approve-probe-${Date.now()}`,
        legal_name: 'Probe LLC',
        display_name: 'Probe',
        business_no: `ARBK-${Date.now()}`,
        contact_name: 'Probe',
        contact_email: `probe-${Date.now()}@biocode.test`,
        contact_phone: '+383 44 000 000',
        address: { city: 'Prishtinë', country_code: 'XK' },
        status: 'pending',
      })
      .select('id, commission_pct, shipping_borne_by')
      .single();

    const merchant = pending as {
      id: string;
      commission_pct: number;
      shipping_borne_by: string | null;
    };
    merchants.push(merchant.id);

    // A pending merchant starts on the column default and no shipping arrangement at all.
    expect(Number(merchant.commission_pct)).toBe(15);
    expect(merchant.shipping_borne_by).toBeNull();

    const { error } = await db
      .from('merchants')
      .update({
        status: 'approved',
        commission_pct: 12.5,
        shipping_borne_by: 'merchant',
        approved_by: admin.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', merchant.id)
      .in('status', ['pending', 'rejected']);

    expect(error).toBeNull();

    const { data: live } = await db
      .from('merchants')
      .select('status, commission_pct, shipping_borne_by, approved_by')
      .eq('id', merchant.id)
      .single();

    const row = live as {
      status: string;
      commission_pct: number;
      shipping_borne_by: string;
      approved_by: string;
    };
    expect(row.status).toBe('approved');
    expect(Number(row.commission_pct)).toBe(12.5);
    expect(row.shipping_borne_by).toBe('merchant');
    expect(row.approved_by).toBe(admin.id);
  });

  /**
   * The settlement follows the approval, which is the whole reason the two are set together.
   *
   * 12.5% of €10 is €1.25, and with shipping on the merchant the €2.00 comes off too — so the
   * merchant is due €6.75. Asserted against the live function rather than recomputed here, because a
   * test that re-implements the arithmetic can agree with a bug.
   */
  it('the approved terms are what settlement uses', async () => {
    const db = serviceClient();
    const merchantId = merchants[merchants.length - 1];
    if (!merchantId) throw new Error('the previous test did not create a merchant');

    const { data, error } = await db.rpc('merchant_settlement', {
      p_merchant_id: merchantId,
      p_items_subtotal_cents: 1000,
    });

    expect(error).toBeNull();
    const settlement = data as Record<string, number | string>;

    expect(settlement.commission_cents).toBe(125);
    expect(settlement.shipping_borne_by).toBe('merchant');
    expect(settlement.shipping_cents).toBe(200);
    expect(settlement.merchant_due_cents).toBe(675);
  });

  /** An already-approved merchant must not be re-approved onto different terms by a stale tab. */
  it('approving twice does not move the terms again', async () => {
    const db = serviceClient();
    const merchantId = merchants[merchants.length - 1];
    if (!merchantId) throw new Error('no merchant');

    await db
      .from('merchants')
      .update({ commission_pct: 99 })
      .eq('id', merchantId)
      .in('status', ['pending', 'rejected']);

    const { data } = await db
      .from('merchants')
      .select('commission_pct')
      .eq('id', merchantId)
      .single();

    expect(Number((data as { commission_pct: number }).commission_pct)).toBe(12.5);
  });
});

describe('a pending merchant can do nothing (docs/16 §4)', () => {
  /**
   * The claim that makes a public application safe: the row exists and grants nothing.
   *
   * `current_merchant_ids()` admits `pending` so an applicant can upload documents and see their own
   * status — that is the point of letting them in — but an offer needs an approved merchant, and the
   * buy box only ever reads approved ones. This asserts the boundary from the merchant's side.
   */
  it('a pending merchant sees its own row and has no live offers', async () => {
    const db = serviceClient();
    const owner = await createUser('merchant');
    created.push(owner.id);

    const { data: created_ } = await db
      .from('merchants')
      .insert({
        slug: `pending-probe-${Date.now()}`,
        legal_name: 'Pending LLC',
        display_name: 'Pending',
        business_no: `ARBK-P-${Date.now()}`,
        contact_name: 'P',
        contact_email: owner.email,
        contact_phone: '+383 44 000 001',
        address: { city: 'Prishtinë', country_code: 'XK' },
        status: 'pending',
      })
      .select('id')
      .single();

    const merchantId = (created_ as { id: string }).id;
    merchants.push(merchantId);
    await db.from('merchant_users').insert({ merchant_id: merchantId, user_id: owner.id });

    const own = await owner.client.from('merchants').select('id, status');
    expect(own.data ?? [], 'an applicant must be able to see their own application').toHaveLength(1);
    expect((own.data as { status: string }[])[0]?.status).toBe('pending');

    // And still nothing belonging to anyone else.
    const others = await owner.client.from('merchant_offers').select('id');
    expect(others.data ?? []).toHaveLength(0);
  });

  it('a rejected merchant loses access entirely', async () => {
    const db = serviceClient();
    const owner = await createUser('merchant');
    created.push(owner.id);

    const { data: row } = await db
      .from('merchants')
      .insert({
        slug: `rejected-probe-${Date.now()}`,
        legal_name: 'Rejected LLC',
        display_name: 'Rejected',
        business_no: `ARBK-R-${Date.now()}`,
        contact_name: 'R',
        contact_email: owner.email,
        contact_phone: '+383 44 000 002',
        address: { city: 'Prishtinë', country_code: 'XK' },
        status: 'rejected',
        rejection_note: 'No import licence supplied.',
      })
      .select('id')
      .single();

    const merchantId = (row as { id: string }).id;
    merchants.push(merchantId);
    await db.from('merchant_users').insert({ merchant_id: merchantId, user_id: owner.id });

    /*
     * `current_merchant_ids()` admits only `pending` and `approved`, so a rejected applicant cannot
     * even read their own row through the table. They still learn the outcome — by email, and the
     * reason is stored — but a rejected account is not a portal account.
     */
    const ids = await owner.client.rpc('current_merchant_ids');
    expect(ids.data ?? []).toHaveLength(0);
  });
});
