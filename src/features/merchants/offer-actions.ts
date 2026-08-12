'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { audit, auditMany, requireCapability } from '@/features/admin/audit';
import { revalidatePublic } from '@/lib/cache';
import { CACHE_TAGS } from '@/lib/constants';
import {
  offerBulkDecisionSchema,
  offerCreateSchema,
  offerDecisionSchema,
  offerIdSchema,
  offerStockSchema,
  offerUpdateSchema,
} from '@/features/merchants/offer-schemas';
import { getMyMerchant, type OfferStatus } from '@/features/merchants/queries';
import { sendOfferDecided } from '@/features/merchants/email';
import {
  classifySkips,
  dedupeIds,
  type BulkOfferDecision,
} from '@/features/merchants/decisions';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/16 §5 — a merchant's offers, and the reviewer's decision on them.
 *
 * ── The rule this file exists to honour ──
 *
 * Every merchant-side mutation goes through the **SSR client on the merchant's own session**, never
 * the service client. That is not a stylistic preference: RLS plus `guard_merchant_offer_write` are
 * what make "a merchant cannot approve its own offer" true, and a service-role write would step over
 * both. If a mutation here is refused, the correct response is a missing policy to add — not a
 * privileged client to reach for.
 *
 * The consequence is that these actions are thin. They validate, they name the merchant, and they
 * let the database enforce the rest. The interesting logic is in the trigger.
 */

export type OfferErrorKey =
  | 'merchant.offers.errors.generic'
  | 'merchant.offers.errors.invalid'
  | 'merchant.offers.errors.notMerchant'
  | 'merchant.offers.errors.notApproved'
  | 'merchant.offers.errors.duplicate'
  | 'merchant.offers.errors.handlingTooLong'
  | 'merchant.offers.errors.locked'
  | 'admin.errors.forbidden';

export type OfferState = ActionResult<{ offerId?: string }, OfferErrorKey> | null;

function no(error: OfferErrorKey): OfferState {
  return fail<OfferErrorKey, { offerId?: string }>(error);
}

/**
 * The marketplace's cap on handling time.
 *
 * Read from settings rather than hard-coded, because it is a commercial policy: BioCode promising
 * delivery windows on its own pages cannot have a supplier quietly taking two weeks. A merchant
 * asking for longer is refused with the number, so the message is actionable.
 */
async function maxHandlingDays(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'marketplace')
    .maybeSingle();

  const value = (data as { value: Record<string, unknown> } | null)?.value ?? {};
  const configured = value.merchant_max_handling_days;
  return typeof configured === 'number' && configured > 0 ? configured : 3;
}

/**
 * The merchant acting, or a refusal.
 *
 * Both statuses are distinguished because they need different answers: somebody who is not a
 * merchant at all has taken a wrong turn, and a merchant who is not yet approved has a real account
 * and needs to be told they are waiting rather than that something went wrong.
 */
async function actingMerchant(): Promise<
  { ok: true; id: string } | { ok: false; error: OfferErrorKey }
> {
  const merchant = await getMyMerchant();
  if (!merchant) return { ok: false, error: 'merchant.offers.errors.notMerchant' };
  if (merchant.status !== 'approved') {
    return { ok: false, error: 'merchant.offers.errors.notApproved' };
  }
  return { ok: true, id: merchant.id };
}

/**
 * Creates an offer, as a draft or straight into review.
 *
 * `submitNow` is a checkbox and the **action** picks the status from it, because a form that posts a
 * status is a form somebody can post `approved` through. The trigger would refuse it — that is the
 * boundary — but relying on the boundary for something the form need never express is how the next
 * form gets it wrong.
 */
export async function createOffer(_previous: OfferState, formData: FormData): Promise<OfferState> {
  const acting = await actingMerchant();
  if (!acting.ok) return no(acting.error);

  const parsed = offerCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.offers.errors.invalid');
  const input = parsed.data;

  const cap = await maxHandlingDays();
  if (input.handlingDays > cap) return no('merchant.offers.errors.handlingTooLong');

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('merchant_offers')
      .insert({
        merchant_id: acting.id,
        variant_id: input.variantId,
        merchant_sku: input.merchantSku || null,
        price_cents: input.priceEuro,
        stock_on_hand: input.stockOnHand,
        low_stock_threshold: input.lowStockThreshold,
        handling_days: input.handlingDays,
        status: input.submitNow ? 'pending_review' : 'draft',
      })
      .select('id')
      .single();

    if (error) {
      /*
       * `unique (merchant_id, variant_id)` — one offer per merchant per variant, so a second one is
       * an edit rather than a new row. Matched on the constraint's code because the message text is
       * Postgres's and will change.
       */
      if (error.code === '23505') return no('merchant.offers.errors.duplicate');
      logger.error('createOffer failed', { cause: error.message, code: error.code });
      return no('merchant.offers.errors.generic');
    }

    revalidatePath('/merchant/offers');
    return ok({ offerId: (data as { id: string }).id });
  } catch (error) {
    logger.error('createOffer threw', describeError(error));
    return no('merchant.offers.errors.generic');
  }
}

/**
 * Edits price, stock, SKU and handling time.
 *
 * It still does not touch `status`, but the reason has changed. `price_change_review` was off in v1 and
 * the owner turned it on (2026-08-10): an approved offer whose **price** changes returns to
 * `pending_review`. That is enforced by `demote_offer_on_price_change`, a trigger, rather than here —
 * because this action is one of three ways a price moves, and `merchant_bulk_upsert_offers` writes
 * straight onto approved rows. A rule that lived in the action would re-review one edited offer and let
 * a pasted sheet of two hundred new prices through, which is the larger hole and the quieter one.
 *
 * Stock is exempt, deliberately: a merchant updating quantities nightly is the ordinary use of this
 * marketplace, and putting every offer into review each evening would make the queue useless.
 *
 * The form says so before saving, because the consequence is real — `variant_buy_box` requires
 * `approved`, so correcting a price takes the product off the shelf until a reviewer looks.
 */
export async function updateOffer(_previous: OfferState, formData: FormData): Promise<OfferState> {
  const acting = await actingMerchant();
  if (!acting.ok) return no(acting.error);

  const parsed = offerUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.offers.errors.invalid');
  const input = parsed.data;

  const cap = await maxHandlingDays();
  if (input.handlingDays > cap) return no('merchant.offers.errors.handlingTooLong');

  try {
    const supabase = await createClient();

    /*
     * `.select()` after the update, and the empty case is the point.
     *
     * A blocked update under RLS matches **zero rows and returns no error** (docs/13 §N7), so an
     * action that only checked `error` would report success for a write that did nothing. Selecting
     * back is how "did this actually happen?" gets answered.
     */
    const { data, error } = await supabase
      .from('merchant_offers')
      .update({
        merchant_sku: input.merchantSku || null,
        price_cents: input.priceEuro,
        stock_on_hand: input.stockOnHand,
        low_stock_threshold: input.lowStockThreshold,
        handling_days: input.handlingDays,
      })
      .eq('id', input.offerId)
      .eq('merchant_id', acting.id)
      .select('id, variant_id, status')
      .maybeSingle();

    if (error) {
      logger.error('updateOffer failed', { cause: error.message });
      return no('merchant.offers.errors.generic');
    }
    if (!data) return no('merchant.offers.errors.locked');

    const row = data as { id: string; variant_id: string; status: string };
    await purgeIfLive(row.status, row.variant_id);

    revalidatePath('/merchant/offers');
    revalidatePath(`/merchant/offers/${input.offerId}`);
    return ok({ offerId: row.id });
  } catch (error) {
    logger.error('updateOffer threw', describeError(error));
    return no('merchant.offers.errors.generic');
  }
}

/** Stock alone, from the inline field on the list — the edit a merchant makes most often. */
export async function updateOfferStock(
  _previous: OfferState,
  formData: FormData,
): Promise<OfferState> {
  const acting = await actingMerchant();
  if (!acting.ok) return no(acting.error);

  const parsed = offerStockSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.offers.errors.invalid');

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('merchant_offers')
      .update({ stock_on_hand: parsed.data.stockOnHand })
      .eq('id', parsed.data.offerId)
      .eq('merchant_id', acting.id)
      .select('id, variant_id, status')
      .maybeSingle();

    if (error) {
      logger.error('updateOfferStock failed', { cause: error.message });
      return no('merchant.offers.errors.generic');
    }
    if (!data) return no('merchant.offers.errors.locked');

    const row = data as { id: string; variant_id: string; status: string };
    await purgeIfLive(row.status, row.variant_id);

    revalidatePath('/merchant/offers');
    return ok({ offerId: row.id });
  } catch (error) {
    logger.error('updateOfferStock threw', describeError(error));
    return no('merchant.offers.errors.generic');
  }
}

/**
 * Moves an offer between the states a merchant owns.
 *
 * The guard trigger is the authority on which moves are legal: `draft`/`rejected` → `pending_review`,
 * `approved` → `paused`, `paused` → `pending_review`. `approved` and `rejected` are the reviewer's
 * and are unreachable from here — the trigger raises `OFFER_STATUS_FORBIDDEN`, which arrives as an
 * error and becomes `locked` rather than a silent no-op.
 */
export async function setOfferStatus(
  _previous: OfferState,
  formData: FormData,
): Promise<OfferState> {
  const acting = await actingMerchant();
  if (!acting.ok) return no(acting.error);

  const parsed = offerIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.offers.errors.invalid');

  const requested = formData.get('status');
  if (requested !== 'pending_review' && requested !== 'paused' && requested !== 'draft') {
    return no('merchant.offers.errors.invalid');
  }

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('merchant_offers')
      .select('status, variant_id')
      .eq('id', parsed.data.offerId)
      .maybeSingle();

    const previousStatus = (before as { status: string; variant_id: string } | null)?.status ?? null;
    const variantId = (before as { variant_id: string } | null)?.variant_id ?? null;

    const { data, error } = await supabase
      .from('merchant_offers')
      .update({ status: requested })
      .eq('id', parsed.data.offerId)
      .eq('merchant_id', acting.id)
      .select('id')
      .maybeSingle();

    if (error) {
      // The trigger's own refusal, which is a legitimate answer rather than a fault.
      if (error.message.includes('OFFER_STATUS_FORBIDDEN')) {
        return no('merchant.offers.errors.locked');
      }
      logger.error('setOfferStatus failed', { cause: error.message });
      return no('merchant.offers.errors.generic');
    }
    if (!data) return no('merchant.offers.errors.locked');

    /*
     * Pausing takes a live offer out of the buy box, so the PDP it was on has to be purged. The
     * previous status is what decides that: moving `draft → pending_review` changes nothing a
     * shopper can see.
     */
    if (variantId && (previousStatus === 'approved' || requested === 'paused')) {
      await purgeIfLive('approved', variantId);
    }

    revalidatePath('/merchant/offers');
    revalidatePath(`/merchant/offers/${parsed.data.offerId}`);
    return ok({ offerId: parsed.data.offerId });
  } catch (error) {
    logger.error('setOfferStatus threw', describeError(error));
    return no('merchant.offers.errors.generic');
  }
}

/**
 * Deletes an offer.
 *
 * Only `draft` and `rejected` can go, and that limit is in the RLS policy rather than here: an
 * approved offer has been reviewed and may already have sourced an order, so it is paused, never
 * removed. A delete that matches no row therefore reads as `locked`.
 */
export async function deleteOffer(_previous: OfferState, formData: FormData): Promise<OfferState> {
  const acting = await actingMerchant();
  if (!acting.ok) return no(acting.error);

  const parsed = offerIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.offers.errors.invalid');

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('merchant_offers')
      .delete()
      .eq('id', parsed.data.offerId)
      .eq('merchant_id', acting.id)
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error('deleteOffer failed', { cause: error.message });
      return no('merchant.offers.errors.generic');
    }
    if (!data) return no('merchant.offers.errors.locked');

    revalidatePath('/merchant/offers');
    return ok({});
  } catch (error) {
    logger.error('deleteOffer threw', describeError(error));
    return no('merchant.offers.errors.generic');
  }
}

// ── The reviewer's decision ──────────────────────────────────────────────────

/**
 * Approves or rejects an offer.
 *
 * Behind `offers.review`, which docs/01 §3 gives to whoever already owns the catalogue: deciding
 * that a third party may sell against a BioCode product page is a catalogue judgement, not a
 * commercial one — the commercial decision was the commission, and it was made at approval of the
 * merchant.
 *
 * Written through the **staff member's own session**, so `p_pm_write` is the policy that permits it
 * and the trigger's staff branch is what allows `approved` to be written at all. A service-role
 * write would work and prove nothing about whether the policies are right.
 */
export async function decideOffer(_previous: OfferState, formData: FormData): Promise<OfferState> {
  const gate = await requireCapability('offers.review');
  if (!gate.ok) return no('admin.errors.forbidden');

  const parsed = offerDecisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.offers.errors.invalid');
  const input = parsed.data;

  // A rejection without a reason is one the merchant cannot act on.
  if (input.decision === 'reject' && (input.note ?? '').trim().length < 5) {
    return no('merchant.offers.errors.invalid');
  }

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('merchant_offers')
      .select('status, variant_id, merchant_id, price_cents')
      .eq('id', input.offerId)
      .maybeSingle();

    if (!before) return no('merchant.offers.errors.invalid');
    const previous = before as {
      status: string;
      variant_id: string;
      merchant_id: string;
      price_cents: number;
    };

    const approving = input.decision === 'approve';

    const { data, error } = await supabase
      .from('merchant_offers')
      .update({
        status: approving ? 'approved' : 'rejected',
        approved_by: approving ? gate.actor.id : null,
        approved_at: approving ? new Date().toISOString() : null,
        rejection_note: approving ? null : (input.note ?? null),
      })
      .eq('id', input.offerId)
      /*
       * Only an offer actually awaiting review can be decided. A stale tab re-approving a live
       * offer would rewrite `approved_at` and, on a rejection, pull it out of the buy box on the
       * strength of a screen somebody left open yesterday.
       */
      .in('status', ['pending_review', 'paused', 'draft'])
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error('decideOffer failed', { cause: error.message });
      return no('merchant.offers.errors.generic');
    }
    if (!data) return no('merchant.offers.errors.locked');

    await audit(
      approving ? 'offer.approved' : 'offer.rejected',
      'merchant_offer',
      input.offerId,
      { status: previous.status },
      {
        status: approving ? 'approved' : 'rejected',
        merchant_id: previous.merchant_id,
        variant_id: previous.variant_id,
        asking_price_cents: previous.price_cents,
        note: input.note ?? null,
      } as unknown as Json,
    );

    /*
     * An approval adds a supplier to a variant and a rejection removes one, so the product page's
     * cached supply is wrong either way.
     */
    await purgeIfLive('approved', previous.variant_id);

    await sendOfferDecided(previous.merchant_id, input.offerId, approving, input.note ?? null);

    revalidatePath('/admin/merchants/offers');
    return ok({ offerId: input.offerId });
  } catch (error) {
    logger.error('decideOffer threw', describeError(error));
    return no('merchant.offers.errors.generic');
  }
}

/**
 * Purges the product page a live offer appears on.
 *
 * `getProduct` caches supply alongside the product for the ISR window (docs/02 §5), so a change to
 * who can supply a variant is invisible until the tag is purged — the same defect class as docs/13
 * §K1, where an admin write left a public page stale.
 *
 * Only for offers that are or were live: a draft edit changes nothing a shopper can see, and purging
 * on every keystroke in the portal would evict the catalogue for nothing.
 */
async function purgeIfLive(status: string, variantId: string): Promise<void> {
  if (status !== 'approved') return;

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('product_variants')
      .select('products ( slug )')
      .eq('id', variantId)
      .maybeSingle();

    const slug = (data as { products: { slug: string } | null } | null)?.products?.slug;
    revalidatePublic(slug ? [CACHE_TAGS.product(slug), CACHE_TAGS.products] : [CACHE_TAGS.products]);
  } catch (error) {
    // A failed purge leaves a page stale for the revalidate window; it must not fail the write.
    logger.error('purgeIfLive threw', { variantId, ...describeError(error) });
  }
}

// ── Several at once ─────────────────────────────────────────────────────────

export type BulkOfferState = ActionResult<BulkOfferDecision, OfferErrorKey> | null;

/**
 * Approves or rejects a selected set of offers.
 *
 * ── One statement, and the RETURNING list is the report ──
 *
 * The write is a single guarded `UPDATE … .in('id', ids).in('status', decidable).select()`. That makes it
 * atomic, and it makes partial failure free: whatever comes back was decided, whatever was asked for and
 * did not come back was not. No per-row loop, no second query, and no window where half the selection is
 * committed and half is not.
 *
 * The status guard is the same one the single decision uses, and it is what makes a stale tab harmless. A
 * row somebody else approved while this page sat open simply is not matched, and it is reported as
 * skipped rather than silently re-approved with a fresh `approved_at`.
 *
 * ── Order of the side effects ──
 *
 * Audit, then purge, then email: cheap-and-irreversible before expensive-and-resumable, so a request
 * killed late has still recorded and announced every decision it made.
 *
 * Written through the reviewer's own session, so `p_pm_write` is the policy that authorises it and the
 * trigger's staff branch is what permits `approved` to be written — exactly as the single path does. A
 * service-role write would work and prove nothing about whether the policies are right.
 */
export async function decideOffersBulk(
  _previous: BulkOfferState,
  formData: FormData,
): Promise<BulkOfferState> {
  // First: a server action is reachable by POST without ever loading the page that hosts its form.
  const gate = await requireCapability('offers.review');
  if (!gate.ok) return fail<OfferErrorKey, BulkOfferDecision>('admin.errors.forbidden');

  /*
   * `getAll`, never `Object.fromEntries` — a repeated checkbox field collapses to its last value. And
   * deduplicated *before* validation, so a doubled input cannot spend cap budget or inflate `requested`
   * so the report claims more rows than the reviewer picked.
   */
  const parsed = offerBulkDecisionSchema.safeParse({
    offerIds: dedupeIds(formData.getAll('offerIds')),
    decision: formData.get('decision'),
    note: formData.get('note') ?? undefined,
  });
  if (!parsed.success) {
    return fail<OfferErrorKey, BulkOfferDecision>('merchant.offers.errors.invalid');
  }
  const input = parsed.data;

  // A rejection with no reason is one the merchant cannot act on. The browser's `required` is a courtesy.
  if (input.decision === 'reject' && (input.note ?? '').trim().length < 5) {
    return fail<OfferErrorKey, BulkOfferDecision>('merchant.offers.errors.invalid');
  }

  const approving = input.decision === 'approve';
  /*
   * Typed as the status union rather than `string[]`, so adding a status to the enum without deciding
   * whether it belongs here is a compile error rather than a silently narrower guard. Same three the
   * single decision allows.
   */
  const DECIDABLE: OfferStatus[] = ['pending_review', 'paused', 'draft'];

  try {
    const supabase = await createClient();

    /*
     * The pre-read comes before anything is written, and a failure here aborts: the audit `before` is not
     * optional, and the skip classification needs each row's prior status plus a label to name it by on
     * screen.
     */
    const { data: beforeRows, error: readError } = await supabase
      .from('v_merchant_offer_detail')
      .select('id, status, merchant_id, variant_id, asking_price_cents, sku, product_slug')
      .in('id', input.offerIds);

    if (readError) {
      logger.error('decideOffersBulk pre-read failed', { cause: readError.message });
      return fail<OfferErrorKey, BulkOfferDecision>('merchant.offers.errors.generic');
    }

    interface BeforeRow {
      id: string;
      status: string;
      merchant_id: string;
      variant_id: string;
      asking_price_cents: number;
      sku: string;
      product_slug: string;
    }
    const before = new Map(
      ((beforeRows ?? []) as unknown as BeforeRow[]).map((row) => [row.id, row]),
    );

    const { data: updated, error: writeError } = await supabase
      .from('merchant_offers')
      .update({
        status: approving ? 'approved' : 'rejected',
        approved_by: approving ? gate.actor.id : null,
        approved_at: approving ? new Date().toISOString() : null,
        rejection_note: approving ? null : (input.note ?? null),
      })
      .in('id', input.offerIds)
      .in('status', DECIDABLE)
      .select('id');

    if (writeError) {
      logger.error('decideOffersBulk write failed', { cause: writeError.message });
      return fail<OfferErrorKey, BulkOfferDecision>('merchant.offers.errors.generic');
    }

    const decidedIds = ((updated ?? []) as { id: string }[]).map((row) => row.id);

    const skipped = classifySkips({
      requested: input.offerIds,
      decided: decidedIds,
      seen: new Map(
        [...before].map(([id, row]) => [id, { status: row.status, label: row.sku }] as const),
      ),
      decidable: DECIDABLE,
    });

    /*
     * The action name stays singular — `offer.approved`, not `offer.bulk_approved` — so "every decision
     * ever made about this offer" remains one query on `entity_id`. The grouping rides in each row's
     * `after` as a shared `bulk_id` instead, which reconstructs the whole action when needed.
     */
    const bulkId = crypto.randomUUID();
    await auditMany(
      approving ? 'offer.approved' : 'offer.rejected',
      'merchant_offer',
      decidedIds.map((id) => {
        const row = before.get(id);
        return {
          entityId: id,
          before: { status: row?.status ?? null },
          after: {
            status: approving ? 'approved' : 'rejected',
            merchant_id: row?.merchant_id ?? null,
            variant_id: row?.variant_id ?? null,
            asking_price_cents: row?.asking_price_cents ?? null,
            note: input.note ?? null,
            bulk: true,
            bulk_id: bulkId,
          } as unknown as Json,
        };
      }),
    );

    /*
     * Purges deduplicated by product.
     *
     * Approving adds a supplier to a variant and rejecting removes one, so the product page is stale
     * either way. Twenty offers spread across three products is three tags, not twenty — the tag is per
     * product, and repeating it would only cost round trips.
     */
    const slugs = new Set(
      decidedIds.flatMap((id) => {
        const slug = before.get(id)?.product_slug;
        return slug ? [slug] : [];
      }),
    );
    if (slugs.size > 0) {
      revalidatePublic([...[...slugs].map((slug) => CACHE_TAGS.product(slug)), CACHE_TAGS.products]);
    }

    /*
     * One email per merchant, not one per offer.
     *
     * Ten offers approved from one merchant is one piece of news from their side, and ten separate emails
     * would read as a fault. Sequential rather than concurrent: nothing in this codebase throttles email,
     * so twenty-five parallel sends would turn a rate limit into a guaranteed burst.
     */
    const byMerchant = new Map<string, string[]>();
    for (const id of decidedIds) {
      const merchantId = before.get(id)?.merchant_id;
      if (!merchantId) continue;
      byMerchant.set(merchantId, [...(byMerchant.get(merchantId) ?? []), id]);
    }

    let merchantsEmailed = 0;
    let emailsFailed = 0;
    for (const [merchantId, offerIds] of byMerchant) {
      const first = offerIds[0];
      if (first === undefined) continue;
      try {
        await sendOfferDecided(merchantId, first, approving, input.note ?? null);
        merchantsEmailed += 1;
      } catch (error) {
        // A failed email must not undo a recorded decision; it is counted and reported instead.
        emailsFailed += 1;
        logger.error('decideOffersBulk email failed', { merchantId, ...describeError(error) });
      }
    }

    revalidatePath('/admin/merchants/offers');

    return ok<BulkOfferDecision>({
      decision: input.decision,
      requested: input.offerIds.length,
      decided: decidedIds.length,
      skipped,
      merchants: byMerchant.size,
      merchantsEmailed,
      emailsFailed,
    });
  } catch (error) {
    logger.error('decideOffersBulk threw', describeError(error));
    return fail<OfferErrorKey, BulkOfferDecision>('merchant.offers.errors.generic');
  }
}
