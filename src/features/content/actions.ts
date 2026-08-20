'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { limit } from '@/lib/rate-limit';
import { clientIpFrom } from '@/lib/utils';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { sendContactAcknowledgement } from '@/features/content/email';
import { getLocale } from 'next-intl/server';
import { DEFAULT_LOCALE, type Locale } from '@/lib/constants';
import { keepSubmitted } from '@/lib/keep-submitted';

/**
 * docs/05 §16 — the contact form.
 *
 * `contact_messages` has no insert policy by design (docs/13 §B5), so the write goes through
 * the `contact_submit` security-definer RPC rather than through a widened service-role
 * allowlist. Same reasoning as the newsletter.
 */

export type ContactErrorKey =
  'contact.errors.checkFields' | 'contact.errors.rateLimited' | 'contact.errors.generic';

export type ContactState = ActionResult<{ id?: string }, ContactErrorKey> | null;

const contactSchema = z.object({
  name: z.string().trim().min(2, 'REQUIRED').max(120),
  email: z.string().trim().email('INVALID_EMAIL').max(254),
  subject: z.string().trim().max(160).optional().or(z.literal('')),
  body: z.string().trim().min(10, 'TOO_SHORT').max(4000),
  /*
   * docs/02 §9 — honeypot, and it is *not* validated as empty.
   *
   * The newsletter route learned this the hard way: constraining it to `''` made a filled
   * honeypot fail validation, so bots were told "invalid" while humans were told "ok" — a
   * reliable signal that the trap exists. It is inspected after parsing instead, and a caught
   * bot gets the identical success response a human does.
   */
  company: z.string().max(256).optional(),
});

async function submitContactImpl(
  _previous: ContactState,
  formData: FormData,
): Promise<ContactState> {
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return fromFieldErrors<ContactErrorKey, { id?: string }>(
      'contact.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  // A caught bot is answered exactly like a success, and nothing is written.
  if (parsed.data.company) return ok({});

  const headerBag = await headers();
  if (!(await limit('contact', clientIpFrom(headerBag)))) {
    return fail<ContactErrorKey, { id?: string }>('contact.errors.rateLimited');
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('contact_submit', {
      p_name: parsed.data.name,
      p_email: parsed.data.email,
      // The RPC's parameter is `text`, not `text | null`, and an omitted optional is `undefined`
      // — which serialises to a missing key rather than to SQL NULL. An empty subject is the
      // honest value for "they did not write one".
      p_subject: parsed.data.subject ?? '',
      p_body: parsed.data.body,
    });

    if (error) {
      logger.error('submitContact failed', { cause: error.message });
      return fail<ContactErrorKey, { id?: string }>('contact.errors.generic');
    }

    /*
     * The acknowledgement is sent after the row is safely written, and its failure is not the
     * sender's problem — the message is recorded either way, and telling someone "that did not
     * send" when it did would make them send it twice.
     */
    const locale = (await getLocale()) as Locale;
    await sendContactAcknowledgement({
      to: parsed.data.email,
      name: parsed.data.name,
      locale: locale === 'en' ? 'en' : DEFAULT_LOCALE,
    });

    return ok({ id: typeof data === 'string' ? data : undefined });
  } catch (error) {
    logger.error('submitContact threw', describeError(error));
    return fail<ContactErrorKey, { id?: string }>('contact.errors.generic');
  }
}

export const submitContact = keepSubmitted(submitContactImpl);
