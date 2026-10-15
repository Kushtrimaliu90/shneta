import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  anonClient,
  createProduct,
  createUser,
  deleteUser,
  required,
  serviceClient,
  type ProductFixture,
  type TestUser,
} from './helpers';
import { apiKeyPrefix, generateApiKey, hashApiKey } from '@/features/merchants/api-keys';

/**
 * docs/18 — the entry point against a real database, written as both a merchant and an attacker.
 *
 * `merchant_api_exec` is called the way the route calls it: through the **anon** client with no
 * session, the key inside the argument. What is asserted is the thing the design rests on — that the
 * transaction-local identity makes the call *be* the merchant for RLS and the triggers, and nothing
 * more than the merchant: alpha's key cannot touch beta's offer, and after the call an anonymous
 * select on `merchant_offers` is still empty.
 *
 * Both directions, as the isolation suite does (docs/16 §3): a merchant *can* create and update its
 * own offers through a key, so a policy that merely denied everything would fail half this file.
 */

interface Merchant {
  id: string;
  owner: TestUser;
  token: string;
  keyId: string;
}

let product: ProductFixture;
let alpha: Merchant;
let beta: Merchant;
let betaOfferId: string;
const users: string[] = [];
const merchantIds: string[] = [];

function must(result: { error: { message: string } | null }, what: string): void {
  if (result.error) throw new Error(`fixture ${what} failed: ${result.error.message}`);
}

async function createMerchant(name: string, status = 'approved'): Promise<Merchant> {
  const db = serviceClient();
  const owner = await createUser('merchant');
  users.push(owner.id);

  const { data: merchant, error } = await db
    .from('merchants')
    .insert({
      slug: `api-${name}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      legal_name: `${name} LLC`,
      display_name: name,
      business_no: `ARBK-API-${name}`,
      contact_name: 'Owner',
      contact_email: owner.email,
      contact_phone: '+383 44 000 000',
      address: { city: 'Prishtinë', country_code: 'XK' },
      status,
      commission_pct: 15,
      iban: 'XK051000000000000000',
    })
    .select('id')
    .single();
  if (error || !merchant) throw new Error(`merchant fixture failed: ${error?.message}`);
  const id = (merchant as { id: string }).id;
  merchantIds.push(id);

  must(
    await db.from('merchant_users').insert({ merchant_id: id, user_id: owner.id }),
    'membership',
  );

  // Minted exactly as the portal action does: the row holds the hash, the test holds the token.
  const token = generateApiKey();
  const { data: key, error: keyError } = await db
    .from('merchant_api_keys')
    .insert({
      merchant_id: id,
      name: `${name} key`,
      key_prefix: apiKeyPrefix(token),
      key_hash: hashApiKey(token),
      created_by: owner.id,
    })
    .select('id')
    .single();
  if (keyError || !key) throw new Error(`key fixture failed: ${keyError?.message}`);

  return { id, owner, token, keyId: (key as { id: string }).id };
}

type Envelope = { ok: boolean; error?: string; data?: unknown };

async function call(token: string, action: string, payload: unknown = {}): Promise<Envelope> {
  const { data, error } = await anonClient().rpc('merchant_api_exec', {
    p_key: token,
    p_action: action,
    p_payload: payload,
  });
  if (error) throw new Error(`exec raised: ${error.message}`);
  return data as Envelope;
}

beforeAll(async () => {
  product = await createProduct({ stock: 0 });
  alpha = await createMerchant('Alpha');
  beta = await createMerchant('Beta');

  const { data: offer, error } = await serviceClient()
    .from('merchant_offers')
    .insert({
      merchant_id: beta.id,
      variant_id: product.variantId,
      merchant_sku: 'BETA-OWN-CODE',
      price_cents: 777,
      stock_on_hand: 9,
      status: 'approved',
    })
    .select('id')
    .single();
  if (error || !offer) throw new Error(`beta offer failed: ${error?.message}`);
  betaOfferId = (offer as { id: string }).id;
});

afterAll(async () => {
  const db = serviceClient();
  if (merchantIds.length > 0) await db.from('merchants').delete().in('id', merchantIds);
  for (const id of users) await deleteUser(id);
});

describe('authentication', () => {
  it('answers `me` for a live key with the merchant and the key prefix', async () => {
    const result = await call(alpha.token, 'me');
    expect(result.ok).toBe(true);
    const data = result.data as {
      merchant: { id: string; display_name: string; status: string };
      key: { name: string; prefix: string };
    };
    expect(data.merchant.id).toBe(alpha.id);
    expect(data.merchant.display_name).toBe('Alpha');
    expect(data.key.prefix).toBe(apiKeyPrefix(alpha.token));
    expect(JSON.stringify(data)).not.toContain(alpha.token);
  });

  it('refuses an unknown key, an empty key and a near-miss with the same answer', async () => {
    for (const bad of [generateApiKey(), '', `${alpha.token.slice(0, -1)}x`]) {
      const result = await call(bad, 'me');
      expect(result).toEqual({ ok: false, error: 'unauthorized' });
    }
  });

  it('refuses a key whose merchant is suspended, and accepts it again once restored', async () => {
    const db = serviceClient();
    must(await db.from('merchants').update({ status: 'suspended' }).eq('id', alpha.id), 'suspend');
    expect((await call(alpha.token, 'me')).error).toBe('unauthorized');
    must(await db.from('merchants').update({ status: 'approved' }).eq('id', alpha.id), 'restore');
    expect((await call(alpha.token, 'me')).ok).toBe(true);
  });

  it('refuses an unknown action without having done anything', async () => {
    expect(await call(alpha.token, 'delete_everything')).toEqual({
      ok: false,
      error: 'unknown_action',
    });
  });

  it('bumps last_used_at on a successful call', async () => {
    const { data } = await serviceClient()
      .from('merchant_api_keys')
      .select('last_used_at')
      .eq('id', alpha.keyId)
      .single();
    expect(required(data, 'key').last_used_at).not.toBeNull();
  });
});

describe('offers, as the merchant', () => {
  it('lists the catalogue with identifiers and no price', async () => {
    const result = await call(alpha.token, 'catalogue');
    expect(result.ok).toBe(true);
    const rows = result.data as { sku: string }[];
    const mine = rows.find((row) => row.sku === product.sku);
    expect(mine).toBeDefined();
    expect(JSON.stringify(mine)).not.toContain('price');
    expect(JSON.stringify(mine)).not.toContain('stock');
  });

  it('creates a draft offer on a published SKU with create: true, then updates its stock', async () => {
    const created = await call(alpha.token, 'offers.upsert', {
      rows: [{ sku: product.sku, price_cents: 1234, stock: 5 }],
      create: true,
    });
    expect(created.ok).toBe(true);
    expect(created.data).toMatchObject({ applied: 0, created: 1, skipped_count: 0 });

    const updated = await call(alpha.token, 'offers.upsert', {
      rows: [{ sku: product.sku, stock: 42 }],
    });
    expect(updated.data).toMatchObject({ applied: 1, created: 0 });

    const listed = await call(alpha.token, 'offers');
    const offers = listed.data as {
      sku: string;
      status: string;
      stock_on_hand: number;
      price_cents: number;
    }[];
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      sku: product.sku,
      status: 'draft',
      stock_on_hand: 42,
      price_cents: 1234,
    });
  });

  it('reports a mistyped SKU instead of creating when create is off', async () => {
    const result = await call(alpha.token, 'offers.upsert', {
      rows: [{ sku: 'NOPE-404', stock: 1 }],
    });
    expect(result.data).toMatchObject({
      applied: 0,
      created: 0,
      skipped: [{ sku: 'NOPE-404', reason: 'no_matching_offer' }],
    });
  });

  it('cannot write the offer status through the key (the write guard still applies)', async () => {
    // The only path to `status` through the API is none: the upsert never sets it. Prove the row
    // is still a draft after everything above, and that a direct write as the owner is refused.
    const { error } = await alpha.owner.client
      .from('merchant_offers')
      .update({ status: 'approved' })
      .eq('merchant_id', alpha.id);
    expect(error?.message).toContain('OFFER_STATUS_FORBIDDEN');
  });
});

describe('offers, as an attacker holding another merchant’s codes', () => {
  it("cannot update beta's offer by its merchant_sku, with or without create", async () => {
    for (const create of [false, true]) {
      const result = await call(alpha.token, 'offers.upsert', {
        rows: [{ sku: 'BETA-OWN-CODE', stock: 0, price_cents: 1 }],
        create,
      });
      expect(result.ok).toBe(true);
      const data = result.data as { applied: number; skipped: { reason: string }[] };
      expect(data.applied).toBe(0);
      expect(data.skipped[0]?.reason).toBe(create ? 'unknown_sku' : 'no_matching_offer');
    }

    const { data } = await serviceClient()
      .from('merchant_offers')
      .select('stock_on_hand, price_cents, status')
      .eq('id', betaOfferId)
      .single();
    expect(data).toEqual({ stock_on_hand: 9, price_cents: 777, status: 'approved' });
  });

  it("does not see beta's offers in its own list", async () => {
    const listed = await call(alpha.token, 'offers');
    const ids = (listed.data as { id: string }[]).map((row) => row.id);
    expect(ids).not.toContain(betaOfferId);
  });

  it('leaves no identity behind: an anonymous select afterwards is empty', async () => {
    await call(alpha.token, 'offers');
    const { data, error } = await anonClient().from('merchant_offers').select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe('proposals', () => {
  it('creates a batch and lists it with a pending count', async () => {
    const created = await call(alpha.token, 'proposals.create', {
      note: 'API test batch',
      rows: [
        { product_name: 'Magnesium Glycinate', brand_name: 'NutriLab', asking_price_cents: 1250 },
        {
          product_name: 'Zinc Picolinate',
          brand_name: 'NutriLab',
          asking_price_cents: 890,
          stock_on_hand: 3,
        },
      ],
    });
    expect(created.ok).toBe(true);
    expect(created.data).toMatchObject({ created: 2, skipped_count: 0 });

    const listed = await call(alpha.token, 'proposals');
    const batches = listed.data as {
      note: string | null;
      row_count: number;
      rows: { pending: number };
    }[];
    expect(batches[0]).toMatchObject({
      note: 'API test batch',
      row_count: 2,
      rows: { pending: 2 },
    });
  });

  it('refuses an empty row list the way the portal does', async () => {
    const { error } = await anonClient().rpc('merchant_api_exec', {
      p_key: alpha.token,
      p_action: 'proposals.create',
      p_payload: { rows: [] },
    });
    expect(error?.message).toContain('NO_ROWS');
  });
});

describe('the key rows themselves', () => {
  it('a merchant may revoke its own key, and the revoked key stops working', async () => {
    const scratch = await createMerchant('Gamma');
    expect((await call(scratch.token, 'me')).ok).toBe(true);

    const { data, error } = await scratch.owner.client
      .from('merchant_api_keys')
      .update({ revoked_at: new Date().toISOString(), revoked_by: scratch.owner.id })
      .eq('id', scratch.keyId)
      .select('id');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    expect(await call(scratch.token, 'me')).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('a revoked key cannot be un-revoked, and the hash cannot be rewritten', async () => {
    const delta = await createMerchant('Delta');
    must(
      await delta.owner.client
        .from('merchant_api_keys')
        .update({ revoked_at: new Date().toISOString(), revoked_by: delta.owner.id })
        .eq('id', delta.keyId),
      'revoke',
    );

    const { error: unrevoke } = await delta.owner.client
      .from('merchant_api_keys')
      .update({ revoked_at: null, revoked_by: null })
      .eq('id', delta.keyId);
    expect(unrevoke?.message).toContain('API_KEY_FIELD_FORBIDDEN');

    const { error: rehash } = await alpha.owner.client
      .from('merchant_api_keys')
      .update({ key_hash: hashApiKey('bck_live_forged') })
      .eq('id', alpha.keyId);
    expect(rehash?.message).toContain('API_KEY_FIELD_FORBIDDEN');
  });

  it('caps a merchant at five active keys', async () => {
    const insert = (name: string) => {
      const token = generateApiKey();
      return alpha.owner.client.from('merchant_api_keys').insert({
        merchant_id: alpha.id,
        name,
        key_prefix: apiKeyPrefix(token),
        key_hash: hashApiKey(token),
        created_by: alpha.owner.id,
      });
    };
    // One exists from the fixture; four more reach the cap.
    for (const n of [2, 3, 4, 5]) must(await insert(`key ${n}`), `key ${n}`);
    const { error } = await insert('key 6');
    expect(error?.message).toContain('API_KEY_LIMIT');
  });

  it("a merchant cannot mint a key for another merchant or see another merchant's keys", async () => {
    const token = generateApiKey();
    const { error } = await alpha.owner.client.from('merchant_api_keys').insert({
      merchant_id: beta.id,
      name: 'forged',
      key_prefix: apiKeyPrefix(token),
      key_hash: hashApiKey(token),
      created_by: alpha.owner.id,
    });
    expect(error).not.toBeNull();

    const { data } = await alpha.owner.client
      .from('merchant_api_keys')
      .select('id')
      .eq('merchant_id', beta.id);
    expect(data).toEqual([]);
  });

  it('a pending merchant cannot create a key', async () => {
    const db = serviceClient();
    const pendingOwner = await createUser('merchant');
    users.push(pendingOwner.id);
    const { data: merchant } = await db
      .from('merchants')
      .insert({
        slug: `api-pending-${Date.now()}`,
        legal_name: 'Pending LLC',
        display_name: 'Pending',
        business_no: 'ARBK-API-PENDING',
        contact_name: 'Owner',
        contact_email: pendingOwner.email,
        contact_phone: '+383 44 000 000',
        address: { city: 'Prishtinë', country_code: 'XK' },
        status: 'pending',
      })
      .select('id')
      .single();
    const id = required(merchant, 'pending merchant').id;
    merchantIds.push(id);
    must(
      await db.from('merchant_users').insert({ merchant_id: id, user_id: pendingOwner.id }),
      'm',
    );

    const token = generateApiKey();
    const { error } = await pendingOwner.client.from('merchant_api_keys').insert({
      merchant_id: id,
      name: 'too early',
      key_prefix: apiKeyPrefix(token),
      key_hash: hashApiKey(token),
      created_by: pendingOwner.id,
    });
    expect(error?.message).toContain('MERCHANT_NOT_APPROVED');
  });
});
