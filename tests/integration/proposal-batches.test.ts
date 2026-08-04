import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, deleteUser, serviceClient, type TestUser } from './helpers';

/**
 * docs/16 §9.1 — a pasted catalogue as one thing a reviewer decides.
 *
 * ── What is worth asserting here ──
 *
 * Not that an INSERT of 200 rows works. Three things that decide whether the feature is safe:
 *
 *   · **the caps hold** — 200 rows per batch and 3 open batches, because the twenty-open cap on individual
 *     proposals exists to stop one merchant making the queue unusable, and exempting batch rows from it
 *     means the limit has to bite somewhere else;
 *   · **approving a batch creates nothing** — 200 draft products with photographs to copy is hundreds of
 *     storage round trips, so approval marks rows and the sweep promotes them. If approval promoted inline
 *     the request would time out in production and nobody would find out here;
 *   · **per-row rejections survive a batch approval**, which is the whole asymmetry: reject is a judgement
 *     about one product, approve is a judgement about the sheet.
 */

const merchantIds: string[] = [];
const userIds: string[] = [];
const batchIds: string[] = [];

let reviewer: TestUser;
let merchantUser: TestUser;

async function createMerchant(name: string): Promise<string> {
  const stamp = `${Date.now()}-${merchantIds.length}`;
  const { data, error } = await serviceClient()
    .from('merchants')
    .insert({
      slug: `batch-${stamp}`,
      legal_name: `${name} SH.P.K.`,
      display_name: name,
      business_no: `ARBK-BT-${stamp}`,
      contact_name: 'Probe',
      contact_email: `batch-${stamp}@biocode.test`,
      contact_phone: '+383 44 000 000',
      address: { city: 'Prishtinë', country_code: 'XK' },
      status: 'approved',
      commission_pct: 20,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`merchant insert failed: ${error?.message}`);
  const id = (data as { id: string }).id;
  merchantIds.push(id);
  return id;
}

/** One row of a pasted sheet, in the shape the RPC reads. */
function row(overrides?: Record<string, unknown>): Record<string, unknown> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    product_name: `Probe Product ${stamp}`,
    brand_name: 'Probe Labs',
    asking_price_cents: 1250,
    stock_on_hand: 5,
    ...overrides,
  };
}

async function createBatch(
  merchantId: string,
  rows: Record<string, unknown>[],
  note?: string,
): Promise<{
  batch_id: string | null;
  created: number;
  skipped: { name: string; reason: string }[];
}> {
  const { data, error } = await serviceClient().rpc('merchant_bulk_create_proposals', {
    p_merchant_id: merchantId,
    p_rows: rows,
    p_note: note ?? null,
  });

  if (error) throw new Error(error.message);
  const result = data as {
    batch_id: string | null;
    created: number;
    skipped: { name: string; reason: string }[];
  };
  if (result.batch_id) batchIds.push(result.batch_id);
  return result;
}

beforeAll(async () => {
  reviewer = await createUser('product_manager');
  merchantUser = await createUser('merchant');
  userIds.push(reviewer.id, merchantUser.id);
});

afterAll(async () => {
  const db = serviceClient();
  for (const id of batchIds) {
    await db.from('product_proposals').delete().eq('batch_id', id);
    await db.from('proposal_batches').delete().eq('id', id);
  }
  for (const id of merchantIds) {
    await db.from('product_proposals').delete().eq('merchant_id', id);
    await db.from('proposal_batches').delete().eq('merchant_id', id);
    await db.from('merchants').delete().eq('id', id);
  }
  for (const id of userIds) await deleteUser(id);
});

describe('creating a batch (docs/16 §9.1)', () => {
  it('creates one batch and one proposal per row', async () => {
    const merchant = await createMerchant('Batch Basic');
    const result = await createBatch(merchant, [row(), row(), row()], 'Our whole importer list.');

    expect(result.created).toBe(3);
    expect(result.skipped).toEqual([]);
    expect(result.batch_id).toBeTruthy();

    const { data: batch } = await serviceClient()
      .from('proposal_batches')
      .select('status, row_count, note')
      .eq('id', result.batch_id ?? '')
      .single();

    const stored = batch as { status: string; row_count: number; note: string };
    expect(stored.status).toBe('pending');
    expect(stored.row_count).toBe(3);
    expect(stored.note).toBe('Our whole importer list.');

    const { data: rows } = await serviceClient()
      .from('product_proposals')
      .select('status, batch_id, payload')
      .eq('batch_id', result.batch_id ?? '');

    const proposals = (rows ?? []) as { status: string; payload: Record<string, unknown> }[];
    expect(proposals).toHaveLength(3);
    expect(proposals.every((entry) => entry.status === 'pending')).toBe(true);
    // Images arrive after the rows, keyed on the barcode or SKU — so the array starts empty, not absent.
    expect(proposals[0]?.payload.images).toEqual([]);
  });

  it('refuses a row with no name, no brand or no price, and takes the rest', async () => {
    const merchant = await createMerchant('Batch Partial');
    const result = await createBatch(merchant, [
      row(),
      row({ product_name: '   ' }),
      row({ brand_name: '' }),
      row({ asking_price_cents: 0, product_name: 'No Price Probe' }),
    ]);

    expect(result.created).toBe(1);
    const reasons = result.skipped.map((entry) => entry.reason).sort();
    expect(reasons).toEqual(['incomplete', 'incomplete', 'no_price']);
  });

  /** A merchant's export repeats a product per variant; approving both would create two canonical pages. */
  it('drops a duplicate inside the same sheet', async () => {
    const merchant = await createMerchant('Batch Dupe');
    const first = row({ product_name: 'Twice Over', barcode: '5099999999901' });
    const again = row({ product_name: 'Twice Over Again', barcode: '5099999999901' });

    const result = await createBatch(merchant, [first, again]);

    expect(result.created).toBe(1);
    expect(result.skipped).toEqual([{ name: 'Twice Over Again', reason: 'duplicate_in_sheet' }]);
  });

  it('drops a row the merchant has already proposed and is still waiting on', async () => {
    const merchant = await createMerchant('Batch Already');
    const name = `Standing Proposal ${Date.now()}`;

    await serviceClient()
      .from('product_proposals')
      .insert({
        merchant_id: merchant,
        status: 'pending',
        payload: { product_name: name, brand_name: 'Probe Labs', asking_price_cents: 900 },
      });

    const result = await createBatch(merchant, [row({ product_name: name })]);

    expect(result.created).toBe(0);
    expect(result.skipped).toEqual([{ name, reason: 'already_proposed' }]);
  });

  /**
   * A sheet where every row was refused leaves no batch behind — otherwise a merchant fixing its
   * spreadsheet burns one of its three slots per attempt and the queue fills with empty tables.
   */
  it('leaves no batch when nothing survived', async () => {
    const merchant = await createMerchant('Batch Empty');
    const result = await createBatch(merchant, [row({ product_name: '' })]);

    expect(result.created).toBe(0);
    expect(result.batch_id).toBeNull();

    const { count } = await serviceClient()
      .from('proposal_batches')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', merchant);
    expect(count ?? 0).toBe(0);
  });

  it('caps a batch at 200 rows', async () => {
    const merchant = await createMerchant('Batch Too Big');
    const rows = Array.from({ length: 201 }, () => row());

    const { error } = await serviceClient().rpc('merchant_bulk_create_proposals', {
      p_merchant_id: merchant,
      p_rows: rows,
    });

    expect(error?.message ?? '').toContain('TOO_MANY_ROWS');
  });

  /** The cap that replaces the twenty-open one for this path. Three tables is a day's review, not a wall. */
  it('caps a merchant at three open batches', async () => {
    const merchant = await createMerchant('Batch Three');
    await createBatch(merchant, [row()]);
    await createBatch(merchant, [row()]);
    await createBatch(merchant, [row()]);

    const { error } = await serviceClient().rpc('merchant_bulk_create_proposals', {
      p_merchant_id: merchant,
      p_rows: [row()],
    });

    expect(error?.message ?? '').toContain('TOO_MANY_OPEN_BATCHES');
  });

  it('a decided batch frees the slot', async () => {
    const merchant = await createMerchant('Batch Frees');
    const one = await createBatch(merchant, [row()]);
    await createBatch(merchant, [row()]);
    await createBatch(merchant, [row()]);

    await serviceClient().rpc('decide_proposal_batch', {
      p_batch_id: one.batch_id,
      p_decision: 'approve',
    });

    const fourth = await createBatch(merchant, [row()]);
    expect(fourth.created).toBe(1);
  });

  it('a merchant cannot create a batch for another merchant', async () => {
    const mine = await createMerchant('Batch Mine');
    const theirs = await createMerchant('Batch Theirs');

    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: mine, user_id: merchantUser.id, role: 'owner' });

    const { error } = await merchantUser.client.rpc('merchant_bulk_create_proposals', {
      p_merchant_id: theirs,
      p_rows: [row()],
    });

    expect(error?.message ?? '').toContain('FORBIDDEN');
  });
});

describe('deciding a batch (docs/16 §9.1)', () => {
  it('approves every pending row and marks the batch decided', async () => {
    const merchant = await createMerchant('Decide Approve');
    const batch = await createBatch(merchant, [row(), row()]);

    const { data, error } = await serviceClient().rpc('decide_proposal_batch', {
      p_batch_id: batch.batch_id,
      p_decision: 'approve',
      p_note: 'Listing all of these. Prices to be set.',
    });

    expect(error).toBeNull();
    expect((data as { decided: number }).decided).toBe(2);

    const { data: rows } = await serviceClient()
      .from('product_proposals')
      .select('status, created_product_id, reviewer_note')
      .eq('batch_id', batch.batch_id ?? '');

    const proposals = (rows ?? []) as {
      status: string;
      created_product_id: string | null;
      reviewer_note: string;
    }[];
    expect(proposals.every((entry) => entry.status === 'approved')).toBe(true);
    expect(proposals[0]?.reviewer_note).toContain('Listing all of these');

    /*
     * **And no products.** Approval records the decision; promotion is swept afterwards because 200 drafts
     * with images to copy is hundreds of storage round trips. If this ever starts returning a product id,
     * the request has been made to do the work inline and will time out in production.
     */
    expect(proposals.every((entry) => entry.created_product_id === null)).toBe(true);

    const { data: after } = await serviceClient()
      .from('proposal_batches')
      .select('status, reviewed_at')
      .eq('id', batch.batch_id ?? '')
      .single();
    expect((after as { status: string }).status).toBe('decided');
    expect((after as { reviewed_at: string | null }).reviewed_at).toBeTruthy();
  });

  it('leaves a row rejected on its own alone', async () => {
    const merchant = await createMerchant('Decide Mixed');
    const batch = await createBatch(merchant, [row(), row(), row()]);

    const { data: rows } = await serviceClient()
      .from('product_proposals')
      .select('id')
      .eq('batch_id', batch.batch_id ?? '')
      .limit(1);
    const rejectedId = ((rows ?? []) as { id: string }[])[0]?.id ?? '';

    // The per-row path: one product judged on its own merits, with its own reason.
    await serviceClient()
      .from('product_proposals')
      .update({
        status: 'rejected',
        reviewer_note: 'We already list this under another brand.',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', rejectedId);

    const { data } = await serviceClient().rpc('decide_proposal_batch', {
      p_batch_id: batch.batch_id,
      p_decision: 'approve',
      p_note: 'The rest are good.',
    });

    expect((data as { decided: number }).decided, 'only the two still pending').toBe(2);

    const { data: still } = await serviceClient()
      .from('product_proposals')
      .select('status, reviewer_note')
      .eq('id', rejectedId)
      .single();

    const row0 = still as { status: string; reviewer_note: string };
    expect(row0.status).toBe('rejected');
    expect(row0.reviewer_note).toContain('already list this');
  });

  it('refuses a rejection with no words', async () => {
    const merchant = await createMerchant('Decide Silent');
    const batch = await createBatch(merchant, [row()]);

    const { error } = await serviceClient().rpc('decide_proposal_batch', {
      p_batch_id: batch.batch_id,
      p_decision: 'reject',
      p_note: 'no',
    });

    expect(error?.message ?? '').toContain('NOTE_REQUIRED');
  });

  it('refuses to decide the same batch twice', async () => {
    const merchant = await createMerchant('Decide Twice');
    const batch = await createBatch(merchant, [row()]);

    await serviceClient().rpc('decide_proposal_batch', {
      p_batch_id: batch.batch_id,
      p_decision: 'approve',
    });

    const { error } = await serviceClient().rpc('decide_proposal_batch', {
      p_batch_id: batch.batch_id,
      p_decision: 'approve',
    });

    expect(error?.message ?? '').toContain('BATCH_ALREADY_DECIDED');
  });

  it('a merchant cannot decide its own batch', async () => {
    const merchant = await createMerchant('Decide Self');
    const batch = await createBatch(merchant, [row()]);

    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: merchant, user_id: merchantUser.id, role: 'owner' });

    const { error } = await merchantUser.client.rpc('decide_proposal_batch', {
      p_batch_id: batch.batch_id,
      p_decision: 'approve',
    });

    expect(error?.message ?? '').toContain('FORBIDDEN');
  });

  it('a product manager can', async () => {
    const merchant = await createMerchant('Decide Reviewer');
    const batch = await createBatch(merchant, [row()]);

    const { error } = await reviewer.client.rpc('decide_proposal_batch', {
      p_batch_id: batch.batch_id,
      p_decision: 'approve',
      p_note: 'Good list.',
    });

    expect(error).toBeNull();
  });
});

/**
 * docs/16 §9.1 — attaching photographs to a pending batch, which is the one write a merchant may make to a
 * row under review (docs/13 §X15).
 *
 * The first version of this went through the merchant's session with a plain UPDATE. `p_own_update` admits
 * only `status = 'needs_info'`, so it matched zero rows — and PostgREST calls a zero-row update a success, so
 * the action reported three photographs attached while attaching none. These assertions exist because a
 * count that comes from the database is the only count worth reporting.
 */
describe('attaching batch photographs (docs/16 §9.1)', () => {
  async function attach(
    batchId: string,
    assignments: { proposal_id: string; path: string }[],
    client = serviceClient(),
  ): Promise<{ attached: number; rejected: number } | { error: string }> {
    const { data, error } = await client.rpc('merchant_attach_batch_images', {
      p_batch_id: batchId,
      p_assignments: assignments,
    });
    if (error) return { error: error.message };
    return data as { attached: number; rejected: number };
  }

  async function firstRow(batchId: string): Promise<string> {
    const { data } = await serviceClient()
      .from('product_proposals')
      .select('id')
      .eq('batch_id', batchId)
      .limit(1);
    return ((data ?? []) as { id: string }[])[0]?.id ?? '';
  }

  it('appends a path and reports what it wrote', async () => {
    const merchant = await createMerchant('Attach One');
    const batch = await createBatch(merchant, [row()]);
    const proposalId = await firstRow(batch.batch_id ?? '');

    const result = await attach(batch.batch_id ?? '', [
      { proposal_id: proposalId, path: `proposals/${merchant}/box-front.png` },
    ]);

    expect(result).toEqual({ attached: 1, rejected: 0 });

    const { data } = await serviceClient()
      .from('product_proposals')
      .select('payload')
      .eq('id', proposalId)
      .single();
    expect((data as { payload: { images: string[] } }).payload.images).toEqual([
      `proposals/${merchant}/box-front.png`,
    ]);
  });

  it('is idempotent for the same path', async () => {
    const merchant = await createMerchant('Attach Twice');
    const batch = await createBatch(merchant, [row()]);
    const proposalId = await firstRow(batch.batch_id ?? '');
    const path = `proposals/${merchant}/same.png`;

    await attach(batch.batch_id ?? '', [{ proposal_id: proposalId, path }]);
    const again = await attach(batch.batch_id ?? '', [{ proposal_id: proposalId, path }]);

    expect(again).toEqual({ attached: 0, rejected: 0 });
  });

  /**
   * The storage policy stops the *upload*; nothing stops a crafted submission naming somebody else's
   * object, and an approved row copies its images onto a public product page.
   */
  it('refuses a path outside the merchant’s own folder', async () => {
    const merchant = await createMerchant('Attach Foreign');
    const other = await createMerchant('Attach Other');
    const batch = await createBatch(merchant, [row()]);
    const proposalId = await firstRow(batch.batch_id ?? '');

    const result = await attach(batch.batch_id ?? '', [
      { proposal_id: proposalId, path: `proposals/${other}/theirs.png` },
      { proposal_id: proposalId, path: `proposals/${merchant}/../escape.png` },
      { proposal_id: proposalId, path: `proposals/${merchant}/nested/deep.png` },
    ]);

    expect(result).toEqual({ attached: 0, rejected: 3 });
  });

  it('refuses a row that is not in this batch', async () => {
    const merchant = await createMerchant('Attach Wrong Row');
    const one = await createBatch(merchant, [row()]);
    const two = await createBatch(merchant, [row()]);
    const rowOfTwo = await firstRow(two.batch_id ?? '');

    const result = await attach(one.batch_id ?? '', [
      { proposal_id: rowOfTwo, path: `proposals/${merchant}/x.png` },
    ]);

    expect(result).toEqual({ attached: 0, rejected: 1 });
  });

  it('refuses once the batch has been decided', async () => {
    const merchant = await createMerchant('Attach Closed');
    const batch = await createBatch(merchant, [row()]);
    const proposalId = await firstRow(batch.batch_id ?? '');

    await serviceClient().rpc('decide_proposal_batch', {
      p_batch_id: batch.batch_id,
      p_decision: 'approve',
    });

    const result = await attach(batch.batch_id ?? '', [
      { proposal_id: proposalId, path: `proposals/${merchant}/late.png` },
    ]);

    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('BATCH_ALREADY_DECIDED');
  });

  it('caps a row at six photographs', async () => {
    const merchant = await createMerchant('Attach Six');
    const batch = await createBatch(merchant, [row()]);
    const proposalId = await firstRow(batch.batch_id ?? '');

    const result = await attach(
      batch.batch_id ?? '',
      Array.from({ length: 8 }, (_, index) => ({
        proposal_id: proposalId,
        path: `proposals/${merchant}/shot-${index}.png`,
      })),
    );

    expect(result).toEqual({ attached: 6, rejected: 0 });
  });

  it('a merchant cannot attach to another merchant’s batch', async () => {
    const mine = await createMerchant('Attach Mine');
    const theirs = await createMerchant('Attach Theirs');
    const batch = await createBatch(theirs, [row()]);
    const proposalId = await firstRow(batch.batch_id ?? '');

    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: mine, user_id: merchantUser.id, role: 'owner' });

    const result = await attach(
      batch.batch_id ?? '',
      [{ proposal_id: proposalId, path: `proposals/${theirs}/x.png` }],
      merchantUser.client,
    );

    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('FORBIDDEN');
  });
});

describe('the promotion queue (docs/16 §9.1)', () => {
  it('an approved row with no product is in it, and a pending one is not', async () => {
    const merchant = await createMerchant('Queue View');
    const pending = await createBatch(merchant, [row()]);
    const approved = await createBatch(merchant, [row(), row()]);

    await serviceClient().rpc('decide_proposal_batch', {
      p_batch_id: approved.batch_id,
      p_decision: 'approve',
    });

    const { data, error } = await serviceClient()
      .from('proposals_awaiting_promotion')
      .select('id, batch_id, image_count')
      .eq('merchant_id', merchant);

    expect(error).toBeNull();
    const queue = (data ?? []) as { batch_id: string; image_count: number }[];
    expect(queue).toHaveLength(2);
    expect(queue.every((entry) => entry.batch_id === approved.batch_id)).toBe(true);
    expect(queue[0]?.image_count).toBe(0);
    expect(queue.some((entry) => entry.batch_id === pending.batch_id)).toBe(false);
  });

  /** Promotion sets `created_product_id`, so a row leaves the queue by being done, not by being marked. */
  it('a row that has its product is out of the queue', async () => {
    const merchant = await createMerchant('Queue Drains');
    const batch = await createBatch(merchant, [row()]);
    await serviceClient().rpc('decide_proposal_batch', {
      p_batch_id: batch.batch_id,
      p_decision: 'approve',
    });

    const { data: before } = await serviceClient()
      .from('proposals_awaiting_promotion')
      .select('id')
      .eq('merchant_id', merchant);
    const proposalId = ((before ?? []) as { id: string }[])[0]?.id ?? '';
    expect(proposalId).toBeTruthy();

    const { data: promoted, error } = await serviceClient().rpc('promote_proposal_to_draft', {
      p_proposal_id: proposalId,
    });
    expect(error).toBeNull();

    const productId = (promoted as { product_id: string }).product_id;

    const { data: after } = await serviceClient()
      .from('proposals_awaiting_promotion')
      .select('id')
      .eq('merchant_id', merchant);
    expect((after ?? []) as unknown[]).toHaveLength(0);

    // Cleanup: this one created real catalogue rows.
    const { data: product } = await serviceClient()
      .from('products')
      .select('brand_id')
      .eq('id', productId)
      .single();
    await serviceClient().from('product_variants').delete().eq('product_id', productId);
    await serviceClient().from('product_proposals').delete().eq('id', proposalId);
    await serviceClient().from('products').delete().eq('id', productId);
    await serviceClient()
      .from('brands')
      .delete()
      .eq('id', (product as { brand_id: string }).brand_id);
  });
});
