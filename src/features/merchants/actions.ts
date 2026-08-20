'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientEnv } from '@/lib/env.client';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { limitByIp } from '@/lib/rate-limit';
import { getCurrentUser } from '@/features/auth/queries';
import { audit, requireCapability } from '@/features/admin/audit';
import {
  approveMerchantSchema,
  merchantApplicationSchema,
  merchantSettlementSchema,
  rejectMerchantSchema,
  requestInfoSchema,
  slugFromName,
} from '@/features/merchants/schemas';
import { MARKETPLACE_TERMS_VERSION } from '@/features/merchants/terms';
import {
  sendApplicationReceived,
  sendMerchantApproved,
  sendMerchantInfoRequested,
  sendMerchantRejected,
} from '@/features/merchants/email';
import type { Json } from '@/lib/supabase/database.types';
import { keepSubmitted } from '@/lib/keep-submitted';

/**
 * docs/16 §4 — applying to sell, and the admin decision on it.
 *
 * The application is a **public, unauthenticated write**, which makes it the most exposed action in
 * the marketplace. Three things guard it: an IP rate limit, a schema that refuses anything it does
 * not recognise, and the fact that a `pending` merchant can do nothing at all — no offers, no
 * catalogue, no orders. An application is a request to be considered, and until an admin approves it
 * the row is inert.
 */

export type MerchantErrorKey =
  | 'merchant.errors.generic'
  | 'merchant.errors.tooMany'
  | 'merchant.errors.duplicate'
  | 'merchant.errors.invalid'
  | 'admin.errors.forbidden';

export type MerchantState = ActionResult<
  { merchantId?: string; slug?: string },
  MerchantErrorKey
> | null;

function no(error: MerchantErrorKey): MerchantState {
  return fail<MerchantErrorKey, { merchantId?: string; slug?: string }>(error);
}

/**
 * Finds a free slug, trying the plain one first.
 *
 * The loop is bounded. An unbounded retry against a unique constraint is a request that never
 * returns when something else is wrong, and four collisions on a business name means the applicant
 * needs a different display name rather than `acme-4`.
 */
async function freeSlug(base: string): Promise<string | null> {
  const supabase = createAdminClient();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data } = await supabase
      .from('merchants')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();

    if (!data) return candidate;
  }
  return null;
}

/**
 * Submits an application.
 *
 * **Service client, and it belongs on the docs/02 §6 list.** An applicant has no session — that is
 * the definition of applying — so there is no user context for RLS to filter, and `merchants` has no
 * anon insert policy precisely because an anon insert policy on the table that grants marketplace
 * access is not something to leave open. The row's shape is fixed here instead.
 *
 * It also links the applicant to the row: an existing account is promoted to `merchant`, and a new
 * email is invited. Either way `merchant_users` gets the membership, which is what
 * `current_merchant_ids()` reads and therefore what every merchant-side policy depends on.
 */
async function submitMerchantApplicationImpl(
  _previous: MerchantState,
  formData: FormData,
): Promise<MerchantState> {
  if (!(await limitByIp('merchantApply', await headers()))) {
    return no('merchant.errors.tooMany');
  }

  const parsed = merchantApplicationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    logger.info('merchant application rejected', {
      cause: parsed.error.issues.map((issue) => issue.path.join('.')).join(','),
    });
    return no('merchant.errors.invalid');
  }

  const input = parsed.data;

  try {
    const supabase = createAdminClient();

    /*
     * One application per business number. A second submission for the same ARBK is either a
     * duplicate the applicant did not mean to send or somebody trying to get a second bite at a
     * rejection, and both are better answered with "we already have this" than with a new row.
     */
    const { data: existing } = await supabase
      .from('merchants')
      .select('id')
      .eq('business_no', input.businessNo)
      .maybeSingle();

    if (existing) return no('merchant.errors.duplicate');

    const slug = await freeSlug(slugFromName(input.displayName));
    if (!slug) return no('merchant.errors.duplicate');

    const { data: created, error } = await supabase
      .from('merchants')
      .insert({
        slug,
        legal_name: input.legalName,
        display_name: input.displayName,
        business_no: input.businessNo,
        vat_no: input.vatNo || null,
        settlement_method: input.settlementMethod,
        /*
         * NULL, not the empty string, when a cash merchant leaves these out. The check constraint in
         * migration 71 tests `nullif(btrim(...), '')` precisely because a form post can supply `''`
         * and `''` is not a bank account — but storing the blank would still leave the admin panel
         * rendering an empty field where "settles in cash" is the honest answer.
         */
        bank_name: input.bankName?.trim() || null,
        iban: input.iban?.trim() || null,
        contact_name: input.contactName,
        contact_email: input.contactEmail,
        contact_phone: input.contactPhone,
        address: {
          line1: input.addressLine,
          city: input.city,
          postal_code: input.postalCode || null,
          country_code: 'XK',
        } as unknown as Json,
        status: 'pending',
        /*
         * Recorded at submission, not at approval. The applicant accepted this version on this
         * date; an admin approving them later does not change what they agreed to (docs/16 §13).
         */
        terms_version: MARKETPLACE_TERMS_VERSION,
        terms_accepted_at: new Date().toISOString(),

        /*
         * What the applicant says they intend to sell, in the column that holds their own account of
         * it. `rejection_note` is the reviewer's and must not be overwritten with this.
         *
         * `imports` is a claim rather than a fact — the import licence either supports it or does
         * not — so it is recorded as part of the narrative the reviewer weighs, next to the document
         * that settles it.
         */
        application_note: [
          `Categories: ${input.categories}`,
          input.catalogSize ? `Expected catalogue: ${input.catalogSize}` : null,
          `Imports directly: ${input.imports ? 'yes' : 'no'}`,
        ]
          .filter(Boolean)
          .join('\n'),
      })
      .select('id, slug')
      .single();

    if (error || !created) {
      logger.error('merchant application insert failed', { cause: error?.message });
      return no('merchant.errors.generic');
    }

    const merchant = created as { id: string; slug: string };

    await linkApplicant(merchant.id, input.contactEmail, input.contactName);

    /*
     * Audited with no actor. `requireCapability` is what normally supplies one, and there is nobody
     * signed in here — but an application is still a thing that happened to a merchant row, and the
     * approval that follows will want the trail to start somewhere.
     */
    await supabase.from('audit_logs').insert({
      actor_id: null,
      action: 'merchant.applied',
      entity_type: 'merchant',
      entity_id: merchant.id,
      after: { business_no: input.businessNo, display_name: input.displayName } as unknown as Json,
    });

    /*
     * Awaited rather than fired off, because a server action's process may be torn down the moment it
     * returns — an unawaited promise is one nobody can prove ran. `sendApplicationReceived` swallows its
     * own failures, so awaiting it cannot fail the application (docs/16 §7).
     */
    await sendApplicationReceived(merchant.id);

    revalidatePath('/admin/merchants/applications');
    return ok({ merchantId: merchant.id, slug: merchant.slug });
  } catch (error) {
    logger.error('submitMerchantApplication threw', describeError(error));
    return no('merchant.errors.generic');
  }
}

export const submitMerchantApplication = keepSubmitted(submitMerchantApplicationImpl);

/**
 * Gives the applicant a way in.
 *
 * Three cases, and the third is the one that matters. If they are signed in, the current user is
 * linked. If the contact email already has an account, that account is linked. Otherwise an invite
 * is sent — Supabase's own invite flow, so the applicant sets their own password and BioCode never
 * holds it.
 *
 * The role is set to `merchant` in every case. It grants nothing on its own: `/merchant` also
 * requires membership, and every policy reads `current_merchant_ids()`, which reads
 * `merchant_users`. The role is what keeps a merchant out of `/admin` (docs/16 §5), not what lets
 * them into the portal.
 *
 * Never throws. A failed invite must not lose the application — the admin can link the account by
 * hand, and the row with its documents is worth far more than the convenience of an automatic
 * invite.
 */
async function linkApplicant(
  merchantId: string,
  contactEmail: string,
  contactName: string,
): Promise<void> {
  const supabase = createAdminClient();

  try {
    const current = await getCurrentUser();
    let userId = current?.id ?? null;

    if (!userId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', contactEmail)
        .maybeSingle();
      userId = (profile as { id: string } | null)?.id ?? null;
    }

    if (!userId) {
      /*
       * `redirectTo` is what makes the invitation land somewhere useful, and its absence was a real
       * defect rather than an omission.
       *
       * Without it Supabase sends the invitee to the project's Site URL — the **storefront home
       * page**. So an approved seller clicked "activate account" in their email and arrived at the
       * shop: signed in, with no password set, no mention of their application, and nothing pointing
       * at `/merchant`. The invite worked and looked like it had failed.
       *
       * `/auth/reset-password` is the set-a-password page. It is reached the same way a recovery link
       * reaches it — through `/api/auth/callback`, which has already exchanged the code for a session
       * — and its `next` now carries the seller into the portal once the password is saved.
       *
       * Double-encoded on purpose: the inner `next` belongs to the reset-password page, the outer one
       * to the callback, and each is decoded by exactly one hop.
       */
      const setPassword = `/auth/reset-password?next=${encodeURIComponent('/merchant')}`;
      const { data: invited, error } = await supabase.auth.admin.inviteUserByEmail(contactEmail, {
        data: { full_name: contactName },
        redirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/api/auth/callback?next=${encodeURIComponent(
          setPassword,
        )}`,
      });
      if (error || !invited.user) {
        logger.error('merchant invite failed', { merchantId, cause: error?.message });
        return;
      }
      userId = invited.user.id;
    }

    // `handle_new_user` defaults every profile to `customer`; the service role is exempt from
    // `prevent_role_escalation` (docs/13 §A4), which is what makes this possible.
    await supabase.from('profiles').update({ role: 'merchant' }).eq('id', userId);
    await supabase
      .from('merchant_users')
      .upsert({ merchant_id: merchantId, user_id: userId, role: 'owner' });
  } catch (error) {
    logger.error('linkApplicant threw', { merchantId, ...describeError(error) });
  }
}

// ── The admin decision ───────────────────────────────────────────────────────

/**
 * Approves a merchant, and sets the commercial terms in the same act.
 *
 * Commission and the shipping arrangement are **required arguments**, not defaults applied silently.
 * A merchant going live on a commission nobody chose is a commercial decision made by a database
 * default, and the first time it is noticed is on a statement.
 */
export async function approveMerchant(
  _previous: MerchantState,
  formData: FormData,
): Promise<MerchantState> {
  const gate = await requireCapability('merchants.manage');
  if (!gate.ok) return no('admin.errors.forbidden');

  const parsed = approveMerchantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.errors.invalid');

  const input = parsed.data;

  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('merchants')
      .update({
        status: 'approved',
        commission_pct: input.commissionPct,
        shipping_borne_by: input.shippingBorneBy,
        ships_own: Boolean(input.shipsOwn),
        collects_cash: Boolean(input.collectsCash),
        approved_by: gate.actor.id,
        approved_at: new Date().toISOString(),
        rejection_note: null,
        suspended_reason: null,
      })
      .eq('id', input.merchantId)
      // Only a pending or rejected application can be approved; an approved one is already live.
      .in('status', ['pending', 'rejected'])
      .select('id, slug')
      .maybeSingle();

    if (error) {
      logger.error('approveMerchant failed', { cause: error.message });
      return no('merchant.errors.generic');
    }
    if (!data) return no('merchant.errors.invalid');

    await audit('merchant.approved', 'merchant', input.merchantId, null, {
      commission_pct: input.commissionPct,
      shipping_borne_by: input.shippingBorneBy,
      ships_own: Boolean(input.shipsOwn),
      collects_cash: Boolean(input.collectsCash),
    });

    await sendMerchantApproved(input.merchantId, {
      commissionPct: input.commissionPct,
      shippingBorneBy: input.shippingBorneBy,
    });

    revalidatePath('/admin/merchants/applications');
    revalidatePath('/admin/merchants');
    return ok({ merchantId: input.merchantId, slug: (data as { slug: string }).slug });
  } catch (error) {
    logger.error('approveMerchant threw', describeError(error));
    return no('merchant.errors.generic');
  }
}

/**
 * Sets or corrects a merchant's settlement details, at any point in their life.
 *
 * Separate from approval on purpose. An IBAN mistyped on the application, a merchant who opens a new
 * account, a cash merchant who now wants a transfer — all of them happen long after approval, and
 * none should require re-running one. Until this existed the only way to fix a payout destination was
 * for the merchant to log in and do it themselves, which is no use when they have phoned to say the
 * number is wrong.
 *
 * ── Written through the admin client, and that is a decision ──
 *
 * The service role bypasses RLS *and* the field guard in `guard_merchant_self_update`, which is the
 * point: `requireCapability` above is the gate, and the guard exists to stop a **merchant** editing
 * commercial terms, not to stop an admin fixing a bank account.
 *
 * What it does not bypass is the audit. Migration 72 moved the `merchant.bank_changed` insert above
 * that function's privilege check precisely so this path is recorded — the trigger fires whoever
 * writes, and the `audit()` call below adds the admin's own intent on top.
 */
export async function updateMerchantSettlement(
  _previous: MerchantState,
  formData: FormData,
): Promise<MerchantState> {
  const gate = await requireCapability('merchants.manage');
  if (!gate.ok) return no('admin.errors.forbidden');

  const parsed = merchantSettlementSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.errors.invalid');

  const input = parsed.data;

  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('merchants')
      .update({
        settlement_method: input.settlementMethod,
        /*
         * Both fields written only when supplied, matching the merchant's own settings form.
         *
         * The blank IBAN contract is load-bearing here: this screen renders the last four digits and
         * nothing else, so an admin correcting a bank *name* submits an empty IBAN field — and
         * treating that as "clear it" would wipe the payout destination of a merchant nobody meant
         * to touch.
         */
        ...(input.bankName?.trim() ? { bank_name: input.bankName.trim() } : {}),
        ...(input.iban ? { iban: input.iban } : {}),
      })
      .eq('id', input.merchantId)
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error('updateMerchantSettlement failed', { cause: error.message });
      /*
       * The check constraint from migration 71, reached when an admin switches a merchant to bank
       * transfer with no account on file. `hasIbanOnFile` should have caught it in the schema; this
       * is the backstop for a stale form whose hidden field no longer matches the row.
       */
      return no(
        error.message.includes('merchants_bank_details_for_transfer')
          ? 'merchant.errors.invalid'
          : 'merchant.errors.generic',
      );
    }
    if (!data) return no('merchant.errors.invalid');

    // The values themselves are not repeated here — the trigger already records the last four
    // digits, and an audit log is not a place to keep a second copy of a bank account.
    await audit('merchant.settlement_updated', 'merchant', input.merchantId, null, {
      settlement_method: input.settlementMethod,
      bank_name_changed: Boolean(input.bankName?.trim()),
      iban_changed: Boolean(input.iban),
    });

    revalidatePath('/admin/merchants/applications');
    revalidatePath('/admin/merchants');
    return ok({ merchantId: input.merchantId });
  } catch (error) {
    logger.error('updateMerchantSettlement threw', describeError(error));
    return no('merchant.errors.generic');
  }
}

export async function rejectMerchant(
  _previous: MerchantState,
  formData: FormData,
): Promise<MerchantState> {
  const gate = await requireCapability('merchants.manage');
  if (!gate.ok) return no('admin.errors.forbidden');

  const parsed = rejectMerchantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.errors.invalid');

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('merchants')
      .update({ status: 'rejected', rejection_note: parsed.data.reason })
      .eq('id', parsed.data.merchantId)
      .eq('status', 'pending');

    if (error) {
      logger.error('rejectMerchant failed', { cause: error.message });
      return no('merchant.errors.generic');
    }

    await audit('merchant.rejected', 'merchant', parsed.data.merchantId, null, {
      reason: parsed.data.reason,
    });

    await sendMerchantRejected(parsed.data.merchantId, parsed.data.reason);

    revalidatePath('/admin/merchants/applications');
    return ok({ merchantId: parsed.data.merchantId });
  } catch (error) {
    logger.error('rejectMerchant threw', describeError(error));
    return no('merchant.errors.generic');
  }
}

/**
 * Asks the applicant for more.
 *
 * Deliberately **not** a status change. `merchant_status` has no `needs_info` value and adding one
 * would mean a fourth state to handle everywhere for something that is really a note on a pending
 * application. The note goes in `rejection_note` — the column that holds "what the reviewer said" —
 * and the row stays `pending`, which is what it is.
 */
export async function requestMerchantInfo(
  _previous: MerchantState,
  formData: FormData,
): Promise<MerchantState> {
  const gate = await requireCapability('merchants.manage');
  if (!gate.ok) return no('admin.errors.forbidden');

  const parsed = requestInfoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.errors.invalid');

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('merchants')
      .update({ rejection_note: parsed.data.note })
      .eq('id', parsed.data.merchantId)
      .eq('status', 'pending');

    if (error) {
      logger.error('requestMerchantInfo failed', { cause: error.message });
      return no('merchant.errors.generic');
    }

    await audit('merchant.info_requested', 'merchant', parsed.data.merchantId, null, {
      note: parsed.data.note,
    });

    await sendMerchantInfoRequested(parsed.data.merchantId, parsed.data.note);

    revalidatePath('/admin/merchants/applications');
    return ok({ merchantId: parsed.data.merchantId });
  } catch (error) {
    logger.error('requestMerchantInfo threw', describeError(error));
    return no('merchant.errors.generic');
  }
}
