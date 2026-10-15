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
import {
  apiKeyPrefix,
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
} from '@/features/merchants/api-keys';
import { API_SCOPES, SCOPE_FOR_ACTION } from '@/features/merchants/api/scopes';

/**
 * docs/18 — scopes, photographs, fulfilments, webhooks and the admin's reach, against a real database.
 *
 * Same discipline as `merchant-api.test.ts`: the entry point is called the way the route calls it,
 * through the anon client with the key inside the argument, and every claim is asserted in both
 * directions — a key with the scope *can*, a key without it *cannot*; alpha's fulfilment is visible
 * to alpha and a 404 to beta.
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
let readOnlyToken: string;
let staff: TestUser;
let admin: TestUser;
const users: string[] = [];
const merchantIds: string[] = [];
const orderIds: string[] = [];

function must(result: { error: { message: string } | null }, what: string): void {
  if (result.error) throw new Error(`fixture ${what} failed: ${result.error.message}`);
}

async function mintKey(merchantId: string, ownerId: string, scopes: readonly string[]) {
  const token = generateApiKey();
  const { data, error } = await serviceClient()
    .from('merchant_api_keys')
    .insert({
      merchant_id: merchantId,
      name: `key ${scopes.length}`,
      key_prefix: apiKeyPrefix(token),
      key_hash: hashApiKey(token),
      scopes: [...scopes],
      created_by: ownerId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`key fixture failed: ${error?.message}`);
  return { token, keyId: (data as { id: string }).id };
}

async function createMerchant(name: string): Promise<Merchant> {
  const db = serviceClient();
  const owner = await createUser('merchant');
  users.push(owner.id);

  const { data, error } = await db
    .from('merchants')
    .insert({
      slug: `apiv2-${name}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      legal_name: `${name} LLC`,
      display_name: name,
      business_no: `ARBK-API2-${name}`,
      contact_name: 'Owner',
      contact_email: owner.email,
      contact_phone: '+383 44 000 000',
      address: { city: 'Prishtinë', country_code: 'XK' },
      status: 'approved',
      commission_pct: 15,
      iban: 'XK051000000000000000',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`merchant fixture failed: ${error?.message}`);
  const id = (data as { id: string }).id;
  merchantIds.push(id);
  must(
    await db.from('merchant_users').insert({ merchant_id: id, user_id: owner.id }),
    'membership',
  );

  const key = await mintKey(id, owner.id, API_SCOPES);
  return { id, owner, ...key };
}

type Envelope = { ok: boolean; error?: string; scope?: string; data?: unknown };

async function call(token: string, action: string, payload: unknown = {}): Promise<Envelope> {
  const { data, error } = await anonClient().rpc('merchant_api_exec', {
    p_key: token,
    p_action: action,
    p_payload: payload,
  });
  if (error) throw new Error(`exec raised: ${error.message}`);
  return data as Envelope;
}

async function callRaw(token: string, action: string, payload: unknown = {}) {
  return anonClient().rpc('merchant_api_exec', {
    p_key: token,
    p_action: action,
    p_payload: payload,
  });
}

/** An order with one merchant fulfilment in the given state, as the isolation suite builds them. */
async function createFulfilment(merchantId: string, status = 'assigned'): Promise<string> {
  const db = serviceClient();
  const { data: order, error } = await db
    .from('orders')
    .insert({
      order_number: `SH-9999-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`,
      email: `buyer-apiv2-${Date.now()}@biocode.test`,
      phone: '+383 44 111 222',
      status: 'confirmed',
      subtotal_cents: 999,
      shipping_cents: 200,
      discount_cents: 0,
      tax_cents: 0,
      total_cents: 1199,
      shipping_address: { full_name: 'A Buyer', city: 'Prishtinë', country_code: 'XK' },
      billing_address: { full_name: 'A Buyer', city: 'Prishtinë', country_code: 'XK' },
      shipping_method: { name: 'Standard' },
    })
    .select('id')
    .single();
  if (error || !order) throw new Error(`order fixture failed: ${error?.message}`);
  const orderId = (order as { id: string }).id;
  orderIds.push(orderId);

  const { data: fulfilment, error: fError } = await db
    .from('order_fulfilments')
    .insert({
      order_id: orderId,
      fulfiller_kind: 'merchant',
      merchant_id: merchantId,
      status,
      items_subtotal_cents: 999,
      commission_cents: 150,
      merchant_due_cents: 849,
      assigned_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (fError || !fulfilment) throw new Error(`fulfilment fixture failed: ${fError?.message}`);
  return (fulfilment as { id: string }).id;
}

beforeAll(async () => {
  product = await createProduct({ stock: 0 });
  alpha = await createMerchant('Alpha2');
  beta = await createMerchant('Beta2');
  readOnlyToken = (await mintKey(alpha.id, alpha.owner.id, ['offers:read', 'orders:read'])).token;
  staff = await createUser('support');
  admin = await createUser('admin');
  users.push(staff.id, admin.id);
});

afterAll(async () => {
  const db = serviceClient();
  for (const id of orderIds) {
    await db.from('order_fulfilments').delete().eq('order_id', id);
    await db.from('orders').delete().eq('id', id);
  }
  if (merchantIds.length > 0) await db.from('merchants').delete().in('id', merchantIds);
  for (const id of users) await deleteUser(id);
});

describe('scopes', () => {
  it('the SQL and the app agree on the scope of every action', async () => {
    for (const [action, scope] of Object.entries(SCOPE_FOR_ACTION)) {
      const { data } = await anonClient().rpc('merchant_api_scope_for', { p_action: action });
      expect(data ?? null, action).toBe(scope);
    }
    const { data: unknown } = await anonClient().rpc('merchant_api_scope_for', {
      p_action: 'nope',
    });
    expect(unknown).toBe('__unknown__');
  });

  it('`me` works for any live key and reports its scopes', async () => {
    const result = await call(readOnlyToken, 'me');
    expect(result.ok).toBe(true);
    expect((result.data as { key: { scopes: string[] } }).key.scopes).toEqual([
      'offers:read',
      'orders:read',
    ]);
  });

  it('a read-only key reads offers and is refused a write, naming the scope', async () => {
    expect((await call(readOnlyToken, 'offers')).ok).toBe(true);
    expect(await call(readOnlyToken, 'offers.upsert', { rows: [{ sku: 'x', stock: 1 }] })).toEqual({
      ok: false,
      error: 'insufficient_scope',
      scope: 'offers:write',
    });
    expect((await call(readOnlyToken, 'webhooks')).error).toBe('insufficient_scope');
  });

  it('scopes are frozen after creation and refused when unknown', async () => {
    const { error: widen } = await alpha.owner.client
      .from('merchant_api_keys')
      .update({ scopes: [...API_SCOPES] })
      .eq('id', alpha.keyId);
    expect(widen?.message).toContain('API_KEY_FIELD_FORBIDDEN');

    const token = generateApiKey();
    const { error: bad } = await alpha.owner.client.from('merchant_api_keys').insert({
      merchant_id: alpha.id,
      name: 'bad scope',
      key_prefix: apiKeyPrefix(token),
      key_hash: hashApiKey(token),
      scopes: ['offers:admin'],
      created_by: alpha.owner.id,
    });
    expect(bad).not.toBeNull();
  });
});

describe('proposal photographs', () => {
  let batchId: string;
  let rowId: string;

  beforeAll(async () => {
    const created = await call(alpha.token, 'proposals.create', {
      rows: [{ product_name: 'Photo Product', brand_name: 'PhotoBrand', asking_price_cents: 500 }],
    });
    batchId = (created.data as { batch_id: string }).batch_id;
    const batch = await call(alpha.token, 'proposals.batch', { batch_id: batchId });
    rowId = required((batch.data as { rows: { id: string }[] }).rows[0], 'batch row').id;
  });

  it('lists the batch with row ids and an image count', async () => {
    const batch = await call(alpha.token, 'proposals.batch', { batch_id: batchId });
    expect(batch.ok).toBe(true);
    expect((batch.data as { rows: { image_count: number }[] }).rows[0]?.image_count).toBe(0);
  });

  it('mints a slot under the merchant prefix, attaches it, and counts it', async () => {
    const slot = await call(alpha.token, 'proposals.image_slot', {
      batch_id: batchId,
      proposal_id: rowId,
      ext: 'jpg',
    });
    expect(slot.ok).toBe(true);
    const path = (slot.data as { path: string }).path;
    expect(path.startsWith(`proposals/${alpha.id}/api-`)).toBe(true);
    expect(path.endsWith('.jpg')).toBe(true);

    const attached = await call(alpha.token, 'proposals.attach_image', {
      batch_id: batchId,
      proposal_id: rowId,
      path,
    });
    expect(attached.data).toMatchObject({ attached: 1, rejected: 0 });

    const batch = await call(alpha.token, 'proposals.batch', { batch_id: batchId });
    expect((batch.data as { rows: { image_count: number }[] }).rows[0]?.image_count).toBe(1);
  });

  it('refuses a bad extension, a sixth image and another merchant’s batch', async () => {
    const { error } = await callRaw(alpha.token, 'proposals.image_slot', {
      batch_id: batchId,
      proposal_id: rowId,
      ext: 'exe',
    });
    expect(error?.message).toContain('BAD_IMAGE_TYPE');

    for (let n = 2; n <= 6; n += 1) {
      await call(alpha.token, 'proposals.attach_image', {
        batch_id: batchId,
        proposal_id: rowId,
        path: `proposals/${alpha.id}/api-${n}.jpg`,
      });
    }
    const { error: full } = await callRaw(alpha.token, 'proposals.image_slot', {
      batch_id: batchId,
      proposal_id: rowId,
      ext: 'png',
    });
    expect(full?.message).toContain('TOO_MANY_IMAGES');

    expect(await call(beta.token, 'proposals.batch', { batch_id: batchId })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(
      (
        await call(beta.token, 'proposals.image_slot', {
          batch_id: batchId,
          proposal_id: rowId,
          ext: 'jpg',
        })
      ).error,
    ).toBe('not_found');
  });

  it("never attaches a path outside the merchant's own folder", async () => {
    const attached = await call(alpha.token, 'proposals.attach_image', {
      batch_id: batchId,
      proposal_id: rowId,
      path: `proposals/${beta.id}/api-stolen.jpg`,
    });
    expect(attached.data).toMatchObject({ attached: 0, rejected: 1 });
  });
});

describe('fulfilments', () => {
  let assigned: string;

  beforeAll(async () => {
    assigned = await createFulfilment(alpha.id);
  });

  it('lists and views its own, with the address released once assigned', async () => {
    const list = await call(alpha.token, 'fulfilments', { status: 'assigned' });
    expect((list.data as { id: string }[]).map((row) => row.id)).toContain(assigned);

    const view = await call(alpha.token, 'fulfilment', { id: assigned });
    expect(view.ok).toBe(true);
    const data = view.data as { ship_to: { name: string } | null; cod_amount_cents: number };
    expect(data.ship_to?.name).toBe('A Buyer');
    expect(JSON.stringify(data)).not.toContain('@biocode.test');
    expect(JSON.stringify(data)).not.toContain('1199');
  });

  it('is a 404 to another merchant and to a key without orders scope', async () => {
    expect(await call(beta.token, 'fulfilment', { id: assigned })).toEqual({
      ok: false,
      error: 'not_found',
    });
    const list = await call(beta.token, 'fulfilments');
    expect((list.data as { id: string }[]).map((row) => row.id)).not.toContain(assigned);

    const onlyOffers = (await mintKey(alpha.id, alpha.owner.id, ['offers:read'])).token;
    expect((await call(onlyOffers, 'fulfilments')).error).toBe('insufficient_scope');
  });

  it('walks the lane: accept → pack → ship, and refuses a skip', async () => {
    const { error: skip } = await callRaw(alpha.token, 'fulfilment.ship', {
      id: assigned,
      carrier: 'DHL',
      tracking_code: 'X1',
    });
    expect(skip?.message).toContain('FULFILMENT_TRANSITION_FORBIDDEN');

    const accepted = await call(alpha.token, 'fulfilment.accept', { id: assigned });
    expect((accepted.data as { fulfilment: { status: string } }).fulfilment.status).toBe(
      'accepted',
    );

    const packed = await call(alpha.token, 'fulfilment.pack', { id: assigned });
    expect((packed.data as { fulfilment: { status: string } }).fulfilment.status).toBe('packed');

    const shipped = await call(alpha.token, 'fulfilment.ship', {
      id: assigned,
      carrier: 'Posta e Kosovës',
      tracking_code: 'RR123456789XK',
    });
    const after = (shipped.data as { fulfilment: { status: string; carrier: string } }).fulfilment;
    expect(after.status).toBe('shipped');
    expect(after.carrier).toBe('Posta e Kosovës');

    // Shipped is terminal for the merchant: a second ship is a wrong state, not a silent no-op.
    const { error: again } = await callRaw(alpha.token, 'fulfilment.accept', { id: assigned });
    expect(again?.message).toContain('FULFILMENT_TRANSITION_FORBIDDEN');
  });

  it('declines with a reason and cannot mark delivered', async () => {
    const other = await createFulfilment(alpha.id);
    const declined = await call(alpha.token, 'fulfilment.decline', {
      id: other,
      reason: 'Out of stock since Monday',
    });
    expect(declined.data).toMatchObject({ fulfilment_id: other, status: 'cancelled' });

    const { data } = await serviceClient()
      .from('order_fulfilments')
      .select('status, cancel_reason')
      .eq('id', other)
      .single();
    expect(data).toEqual({ status: 'cancelled', cancel_reason: 'Out of stock since Monday' });

    // No action exists for it, and a direct write as the owner is refused by the guard.
    expect((await call(alpha.token, 'fulfilment.deliver', { id: other })).error).toBe(
      'unknown_action',
    );
  });
});

describe('webhooks', () => {
  let webhookId: string;
  const secret = generateWebhookSecret();

  it('registers an endpoint and returns the secret once', async () => {
    const created = await call(alpha.token, 'webhook.create', {
      url: 'https://erp.example/hooks/biocode',
      events: ['offer.approved', 'fulfilment.assigned'],
      description: 'ERP',
      secret,
    });
    expect(created.ok).toBe(true);
    const data = created.data as { id: string; secret: string; status: string };
    expect(data.secret).toBe(secret);
    expect(data.status).toBe('active');
    webhookId = data.id;

    const list = await call(alpha.token, 'webhooks');
    expect(JSON.stringify(list.data)).not.toContain(secret);
    expect((list.data as { id: string }[]).map((row) => row.id)).toContain(webhookId);
  });

  it('refuses http, an unknown event and a sixth endpoint', async () => {
    const { error: http } = await callRaw(alpha.token, 'webhook.create', {
      url: 'http://erp.example/x',
      events: ['ping'],
      secret: generateWebhookSecret(),
    });
    expect(http?.message).toContain('merchant_webhooks_');

    const { error: event } = await callRaw(alpha.token, 'webhook.create', {
      url: 'https://erp.example/x',
      events: ['order.paid'],
      secret: generateWebhookSecret(),
    });
    expect(event?.message).toContain('merchant_webhooks_events_valid');

    for (let n = 2; n <= 5; n += 1) {
      const more = await call(alpha.token, 'webhook.create', {
        url: `https://erp.example/hooks/${n}`,
        events: ['ping'],
        secret: generateWebhookSecret(),
      });
      expect(more.ok, `endpoint ${n}`).toBe(true);
    }
    const { error: sixth } = await callRaw(alpha.token, 'webhook.create', {
      url: 'https://erp.example/hooks/6',
      events: ['ping'],
      secret: generateWebhookSecret(),
    });
    expect(sixth?.message).toContain('TOO_MANY_WEBHOOKS');
  });

  it('a reviewer approving the offer enqueues one delivery for the subscribed endpoint', async () => {
    const created = await call(alpha.token, 'offers.upsert', {
      rows: [{ sku: product.sku, price_cents: 900, stock: 3 }],
      create: true,
    });
    expect(created.data).toMatchObject({ created: 1 });

    const { data: offer } = await serviceClient()
      .from('merchant_offers')
      .select('id')
      .eq('merchant_id', alpha.id)
      .eq('variant_id', product.variantId)
      .single();
    const offerId = required(offer, 'offer').id;

    must(
      await serviceClient()
        .from('merchant_offers')
        .update({ status: 'approved' })
        .eq('id', offerId),
      'approve',
    );

    const deliveries = await call(alpha.token, 'webhook.deliveries', { id: webhookId });
    const rows = deliveries.data as { event: string; status: string }[];
    expect(rows.filter((row) => row.event === 'offer.approved')).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');

    // The other four endpoints subscribe only to ping, so they got nothing.
    const { count } = await serviceClient()
      .from('merchant_webhook_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', alpha.id)
      .eq('event', 'offer.approved');
    expect(count).toBe(1);
  });

  it('routing a fulfilment to the merchant enqueues fulfilment.assigned', async () => {
    await createFulfilment(alpha.id);
    const deliveries = await call(alpha.token, 'webhook.deliveries', { id: webhookId });
    const rows = deliveries.data as { event: string }[];
    expect(rows.some((row) => row.event === 'fulfilment.assigned')).toBe(true);
  });

  it('the cron claims due rows once, with backoff, and records outcomes', async () => {
    const db = serviceClient();
    const ping = await call(alpha.token, 'webhook.ping', { id: webhookId });
    const deliveryId = (ping.data as { delivery_id: string }).delivery_id;

    const { data: claimed } = await db.rpc('claim_webhook_deliveries', { p_limit: 100 });
    const rows = claimed as { id: string; url: string; secret: string; attempts: number }[];
    const mine = rows.find((row) => row.id === deliveryId);
    expect(mine).toBeDefined();
    expect(mine?.attempts).toBe(1);
    expect(mine?.secret).toBe(secret);

    // Claimed means not due again until the backoff elapses: a second claim returns nothing for it.
    const { data: again } = await db.rpc('claim_webhook_deliveries', { p_limit: 100 });
    expect((again as { id: string }[]).map((row) => row.id)).not.toContain(deliveryId);

    must(
      await db.rpc('record_webhook_delivery', {
        p_delivery_id: deliveryId,
        p_ok: false,
        p_status_code: 500,
        p_error: 'HTTP 500',
      }),
      'record failure',
    );
    const { data: afterFail } = await db
      .from('merchant_webhook_deliveries')
      .select('status, attempts, last_status_code')
      .eq('id', deliveryId)
      .single();
    expect(afterFail).toEqual({ status: 'pending', attempts: 1, last_status_code: 500 });

    must(
      await db.rpc('record_webhook_delivery', {
        p_delivery_id: deliveryId,
        p_ok: true,
        p_status_code: 204,
      }),
      'record success',
    );
    const { data: afterOk } = await db
      .from('merchant_webhook_deliveries')
      .select('status, delivered_at')
      .eq('id', deliveryId)
      .single();
    expect(afterOk?.status).toBe('delivered');
    expect(afterOk?.delivered_at).not.toBeNull();

    const { data: hook } = await db
      .from('merchant_webhooks')
      .select('consecutive_failures')
      .eq('id', webhookId)
      .single();
    expect(hook?.consecutive_failures).toBe(0);
  });

  it('the claim and record functions are closed to everyone but the service role', async () => {
    const { error } = await alpha.owner.client.rpc('claim_webhook_deliveries', { p_limit: 1 });
    expect(error).not.toBeNull();
    const { error: anon } = await anonClient().rpc('record_webhook_delivery', {
      p_delivery_id: '00000000-0000-4000-8000-000000000000',
      p_ok: true,
    });
    expect(anon).not.toBeNull();
  });

  it('twenty-five failures in a row disable the endpoint, and the merchant can re-enable it', async () => {
    const db = serviceClient();
    for (let n = 0; n < 25; n += 1) {
      const ping = await call(alpha.token, 'webhook.ping', { id: webhookId });
      const id = (ping.data as { delivery_id: string }).delivery_id;
      must(
        await db.rpc('record_webhook_delivery', {
          p_delivery_id: id,
          p_ok: false,
          p_error: 'down',
        }),
        `failure ${n}`,
      );
    }
    const { data: disabled } = await db
      .from('merchant_webhooks')
      .select('status, disabled_reason')
      .eq('id', webhookId)
      .single();
    expect(disabled).toEqual({ status: 'disabled', disabled_reason: 'too_many_failures' });

    const updated = await call(alpha.token, 'webhook.update', { id: webhookId, status: 'active' });
    expect((updated.data as { status: string }).status).toBe('active');
    const { data: enabled } = await db
      .from('merchant_webhooks')
      .select('status, disabled_reason')
      .eq('id', webhookId)
      .single();
    expect(enabled).toEqual({ status: 'active', disabled_reason: null });
  });

  it('rotates the secret and deletes the endpoint with its deliveries', async () => {
    const rotated = await call(alpha.token, 'webhook.rotate', {
      id: webhookId,
      secret: generateWebhookSecret(),
    });
    expect(rotated.ok).toBe(true);
    const { data: row } = await serviceClient()
      .from('merchant_webhooks')
      .select('secret')
      .eq('id', webhookId)
      .single();
    expect(row?.secret).not.toBe(secret);

    expect((await call(beta.token, 'webhook.delete', { id: webhookId })).error).toBe('not_found');
    expect((await call(alpha.token, 'webhook.delete', { id: webhookId })).ok).toBe(true);
    const { count } = await serviceClient()
      .from('merchant_webhook_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('webhook_id', webhookId);
    expect(count).toBe(0);
  });
});

describe('the admin’s reach', () => {
  it('staff read every key and endpoint; only an admin revokes or disables', async () => {
    const { data: seen } = await staff.client.from('merchant_api_keys').select('id, scopes');
    expect((seen ?? []).map((row) => row.id)).toContain(alpha.keyId);

    const { data: hooks } = await staff.client.from('merchant_webhooks').select('id');
    expect((hooks ?? []).length).toBeGreaterThan(0);

    // Support may read, not write: the update matches zero rows under RLS.
    const { data: tried } = await staff.client
      .from('merchant_api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', alpha.keyId)
      .select('id');
    expect(tried).toEqual([]);

    const { data: revoked, error } = await admin.client
      .from('merchant_api_keys')
      .update({ revoked_at: new Date().toISOString(), revoked_by: admin.id })
      .eq('id', beta.keyId)
      .select('id');
    expect(error).toBeNull();
    expect(revoked).toHaveLength(1);
    expect(await call(beta.token, 'me')).toEqual({ ok: false, error: 'unauthorized' });
  });

  it("a merchant cannot see another merchant's keys or endpoints", async () => {
    const { data: keys } = await beta.owner.client
      .from('merchant_api_keys')
      .select('id')
      .eq('merchant_id', alpha.id);
    expect(keys).toEqual([]);
    const { data: hooks } = await beta.owner.client
      .from('merchant_webhooks')
      .select('id')
      .eq('merchant_id', alpha.id);
    expect(hooks).toEqual([]);
    const { data: deliveries } = await beta.owner.client
      .from('merchant_webhook_deliveries')
      .select('id')
      .eq('merchant_id', alpha.id);
    expect(deliveries).toEqual([]);
  });
});
