'use server';

import { randomBytes } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { limitByIp } from '@/lib/rate-limit';
import { getCurrentUser } from '@/features/auth/queries';
import { addToCart } from '@/features/cart/actions';
import { getApprovedConfig, getProtocolCatalog } from '@/features/biohack/config-loader';
import { generateProtocol } from '@/features/biohack/engine';
import { budgetCeilingCents, isGated, readAnswerForm } from '@/features/biohack/schemas';
import type { ProtocolInputs, ProtocolResult } from '@/features/biohack/types';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/15 §3 — generating a protocol.
 *
 * One entry point. Step 2's form posts here, the answers are validated, the engine runs and the
 * result is stored under a share code; the customer is redirected to it. The result page then
 * renders the **stored snapshot** rather than regenerating, which is what makes a protocol stable:
 * a customer who reopens the link a week after the catalogue changed sees the protocol they were
 * given, not a different one.
 */

/**
 * A share code: 80 bits of `randomBytes`, base32, lowercase.
 *
 * These identify the row for anyone holding the URL — `get_shared_protocol` asks for nothing else
 * — so guessing one has to be hopeless. Sixteen characters from an unbiased alphabet is; a
 * timestamp, a counter or `Math.random()` would not be.
 *
 * The alphabet drops the four characters that get misread when a code is spoken or typed from a
 * screenshot (i, l, o, u), leaving 32 exactly.
 */
const ALPHABET = 'abcdefghjkmnpqrstvwxyz0123456789';

function shareCode(): string {
  return [...randomBytes(16)]
    .map((byte) => ALPHABET[byte % 32])
    .join('')
    .slice(0, 16);
}

/**
 * Locale-aware paths, built by hand.
 *
 * `next/navigation`'s `redirect` rather than next-intl's, because only the former is typed
 * `never` — and that type is what lets the compiler see that nothing after a redirect runs. With
 * next-intl's the whole function reads as fallthrough and every later narrowing is lost. The
 * prefix rule is one line (`sq` is unprefixed, per `routing.ts`), so the trade is worth it; the
 * Finder's `submitFinder` does the same.
 */
function path(locale: string, suffix: string): string {
  return locale === 'sq' ? `/biohack${suffix}` : `/${locale}/biohack${suffix}`;
}

/**
 * Step 2 → the protocol.
 *
 * Ends in a redirect on every path, so it never returns. That is deliberate: the result lives at
 * a URL from the first moment, which makes the back button, a refresh, a bookmark and a shared
 * link all work without a line of client state — the same reasoning as the Finder's query-string
 * steps (docs/05 §10).
 *
 * Failures redirect back to step 2 with `?gabim=1` rather than returning an error, for the same
 * reason: a `useActionState` error would be lost on the next navigation anyway.
 */
export async function buildProtocol(formData: FormData): Promise<never> {
  const locale = await getLocale();

  const parsed = readAnswerForm(formData);
  if (!parsed.success) {
    logger.warn('buildProtocol rejected answers', {
      cause: parsed.error.issues.map((i) => i.path.join('.')).join(','),
    });
    redirect(path(locale, '?gabim=1'));
  }

  const answers = parsed.data;

  /*
   * docs/15 §1 step 2 — the hard gate, before anything else runs.
   *
   * No config load, no engine, and above all **no row**. A protocol for someone who is pregnant,
   * nursing or under 18 must not exist even as a stored artefact with `gated: true` on it: there
   * is nothing to store, and the guidance screen is a static page that needs no record.
   *
   * `isGated` rather than a field, because under-18 is now derived from the age band while
   * pregnancy is declared, and the two must be decided in one place (docs/15 §9).
   */
  if (isGated(answers)) {
    redirect(path(locale, '/kujdes'));
  }

  /*
   * An unauthenticated endpoint that writes a row and does five reads. Limited by IP at 10/h,
   * the budget docs/15 §3 asks for — generous for a person answering three questions, and low
   * enough that the table cannot be filled from one host.
   *
   * Outside the try, like the Finder's: `redirect()` throws, and a catch around it would swallow
   * the redirect and log a failure that did not happen.
   */
  if (!(await limitByIp('protocolBuild', await headers()))) {
    redirect(path(locale, '?gabim=shume'));
  }

  let code: string | null = null;

  try {
    const [config, catalog] = await Promise.all([getApprovedConfig(), getProtocolCatalog()]);

    /*
     * No approved config means the feature is not live. Better a "not available" screen than an
     * empty protocol that looks like the generator considered the answers and found nothing.
     */
    if (!config) {
      logger.error('buildProtocol found no approved config');
      redirect(path(locale, '?gabim=1'));
    }

    const inputs: ProtocolInputs = {
      goals: answers.goals,
      diet: answers.diet,
      caffeine: answers.caffeine,
      restrictedLifeStage: false,
      medication: answers.medication,
      level: answers.level,
      budgetCents: budgetCeilingCents(answers.budget, config.settings.budgetTiers),
      /*
       * Spread rather than listed, so an omitted band stays omitted.
       *
       * The engine reads a missing band as "no rule applies". Writing the key explicitly with an
       * undefined value would serialise into the stored `inputs` jsonb as null, which reads back
       * as an answer that was given — and a stored protocol is meant to reproduce exactly.
       */
      ...(answers.ageBand ? { ageBand: answers.ageBand } : {}),
      ...(answers.sex ? { sex: answers.sex } : {}),
      ...(answers.weightBand ? { weightBand: answers.weightBand } : {}),
      ...(answers.heightBand ? { heightBand: answers.heightBand } : {}),
      ...(answers.activity ? { activity: answers.activity } : {}),
    };

    const result = generateProtocol(config, catalog, inputs);
    code = await persist(result, inputs, answers.budget);
  } catch (error) {
    /*
     * `redirect()` inside the try throws a Next.js control-flow error. Rethrowing anything that
     * is not a real failure keeps the two apart — swallowing it would leave the customer on a
     * page that had already decided to navigate away.
     */
    if (isRedirectError(error)) throw error;
    logger.error('buildProtocol threw', describeError(error));
  }

  if (!code) redirect(path(locale, '?gabim=1'));
  redirect(path(locale, `/${code}`));
}

/**
 * Stores the snapshot and returns its code.
 *
 * **Service client, and listed in docs/02 §6.** `generated_protocols` has no insert policy for
 * anyone — docs/15 §2 says "insert via action only" — because a guest has no session to write
 * under and an anon insert policy would let anyone write arbitrary rows into the table that backs
 * the analytics card. So the write happens here, server-side, with the row's shape fixed by this
 * function rather than by the caller.
 *
 * A collision on the code is not retried into the void: two attempts, then give up and let the
 * caller show an error. At 80 bits the second attempt is already superstition.
 */
async function persist(
  result: ProtocolResult,
  inputs: ProtocolInputs,
  budgetTier: string,
): Promise<string | null> {
  const user = await getCurrentUser();
  const supabase = createAdminClient();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const code = shareCode();

    const { error } = await supabase.from('generated_protocols').insert({
      share_code: code,
      user_id: user?.id ?? null,
      config_version: result.configVersion,
      // The tier label travels alongside the resolved ceiling: the ceiling is what the engine
      // used, the label is what the customer picked, and the two stop matching the day someone
      // edits `budget_tiers`.
      inputs: { ...inputs, budgetTier } as unknown as Json,
      result: result as unknown as Json,
    });

    if (!error) return code;
    if (error.code !== '23505') {
      logger.error('generated_protocols insert failed', { cause: error.message });
      return null;
    }
  }

  logger.error('generated_protocols insert failed: two code collisions');
  return null;
}

// ── The result page's three actions ──────────────────────────────────────────

export type ProtocolErrorKey =
  | 'biohack.errorGeneric'
  | 'biohack.errorAddToCart'
  | 'biohack.errorSave'
  | 'biohack.errorSubscribe'
  | 'biohack.addAllEmpty';

export type ProtocolActionState = ActionResult<
  { added?: number; requested?: number; saved?: boolean },
  ProtocolErrorKey
> | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHARE_CODE = /^[a-z0-9]{8,32}$/;

/** docs/07 §8 — the one cadence a protocol converts to. A 28-day protocol restocks monthly. */
const PROTOCOL_FREQUENCY_DAYS = 30;

const addAllSchema = z.object({
  variantIds: z.string().max(2000),
  subscribe: z.coerce.boolean().optional(),
});

/**
 * docs/15 §1 — "Shto gjithçka në shportë", and the subscription conversion behind the same door.
 *
 * Delegates to `addToCart` per line rather than writing `cart_items` directly, so a protocol goes
 * through the same stock check, the same guest-cart cookie and the same quantity cap as any other
 * add. The Finder's `addRoutineToCart` made the same call for the same reason: a second path into
 * the cart is a second place for the cart to be wrong.
 *
 * **"Kthe në abonim" is this action with `subscribe=1`,** which sets `subscribe_frequency_days` on
 * every line and lets checkout create the subscription (docs/07 §8.1). It is not a second
 * subscription-creation path, and that is deliberate: a subscription needs a shipping address, a
 * shipping method and a payment provider, none of which exist on a protocol page. Inventing a
 * subscription without them would produce a schedule that cannot ship.
 *
 * Partial success is reported as success with a count rather than rolled back — a customer who
 * asked for five and can have four wants the four.
 */
export async function addProtocolToCart(
  _previous: ProtocolActionState,
  formData: FormData,
): Promise<ProtocolActionState> {
  const parsed = addAllSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail<ProtocolErrorKey, never>('biohack.errorAddToCart');

  const variantIds = [
    ...new Set(
      parsed.data.variantIds
        .split(',')
        .map((id) => id.trim())
        .filter((id) => UUID.test(id)),
    ),
  ];

  if (variantIds.length === 0) return fail<ProtocolErrorKey, never>('biohack.addAllEmpty');

  let added = 0;

  for (const variantId of variantIds) {
    const line = new FormData();
    line.set('variantId', variantId);
    line.set('quantity', '1');
    if (parsed.data.subscribe) {
      line.set('subscribeFrequencyDays', String(PROTOCOL_FREQUENCY_DAYS));
    }

    const result = await addToCart(line);
    if (result.ok) added += 1;
  }

  if (added === 0) {
    return fail<ProtocolErrorKey, never>(
      parsed.data.subscribe ? 'biohack.errorSubscribe' : 'biohack.errorAddToCart',
    );
  }

  return ok({ added, requested: variantIds.length });
}

const saveSchema = z.object({ code: z.string().regex(SHARE_CODE) });

/**
 * docs/15 §1 — "Ruaje", and docs/15 §6's guest round trip.
 *
 * The protocol is already stored the moment it is generated, so saving is not a write of the
 * result — it is **claiming** the row for the signed-in account. That is what makes the guest
 * flow work without encoding anything into the redirect: the guest signs in, comes back to the
 * same URL, presses save, and the row that was already there gains an owner.
 *
 * Only an unowned row can be claimed. A protocol that already belongs to someone is not
 * transferable by whoever holds the link, which is the whole reason the check is a condition on
 * the update rather than a read followed by a write.
 */
export async function saveProtocol(
  _previous: ProtocolActionState,
  formData: FormData,
): Promise<ProtocolActionState> {
  const parsed = saveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail<ProtocolErrorKey, never>('biohack.errorSave');

  try {
    const user = await getCurrentUser();
    if (!user) return fail<ProtocolErrorKey, never>('biohack.errorSave');

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('generated_protocols')
      .update({ user_id: user.id })
      .eq('share_code', parsed.data.code)
      .is('user_id', null)
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error('saveProtocol failed', { cause: error.message });
      return fail<ProtocolErrorKey, never>('biohack.errorSave');
    }

    /*
     * No row updated means it was already claimed. If the claimant is this same user — someone
     * pressing save twice — that is a success, not an error.
     */
    if (!data) {
      const { data: owned } = await supabase
        .from('generated_protocols')
        .select('id')
        .eq('share_code', parsed.data.code)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!owned) return fail<ProtocolErrorKey, never>('biohack.errorSave');
    }

    return ok({ saved: true });
  } catch (error) {
    logger.error('saveProtocol threw', describeError(error));
    return fail<ProtocolErrorKey, never>('biohack.errorSave');
  }
}

function isRedirectError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
