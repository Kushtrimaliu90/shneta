import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { limitByIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { isLocale, DEFAULT_LOCALE } from '@/lib/constants';
import { sendNewsletterConfirmation } from '@/features/content/email';

/**
 * docs/08 §5 — newsletter opt-in.
 *
 * A route handler rather than a server action because the footer form must work without
 * JavaScript (it is a plain `<form method="post">`), and the shipped shell already points
 * at this path. Until this existed the form returned a 500 on the deployed site.
 *
 * M8 completes the loop: the RPC returns the confirm token and this sends the opt-in email
 * (docs/08 §5). The token never reaches the browser — the response is identical whether the
 * address was new, already subscribed or already confirmed, because anything else would let a
 * stranger test which addresses are on the list.
 */
const schema = z.object({
  email: z.string().email().max(254),
  /*
   * docs/02 §9 — honeypot. Accepts any string on purpose: constraining it to empty made
   * a filled honeypot fail *validation*, so bots were answered "invalid" while humans got
   * "ok" — a reliable signal that the trap exists. It is inspected after parsing instead,
   * and a caught bot gets the identical success response a human does.
   */
  company: z.string().max(256).optional(),
  locale: z.string().optional(),
});

function back(request: NextRequest, status: 'ok' | 'invalid' | 'throttled') {
  const referer = request.headers.get('referer');
  const target = referer ? new URL(referer) : new URL('/', request.url);
  target.searchParams.set('newsletter', status);
  target.hash = 'footer-newsletter-email';
  return NextResponse.redirect(target, { status: 303 });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const parsed = schema.safeParse({
    email: form.get('email'),
    company: form.get('company') ?? '',
    locale: form.get('locale') ?? undefined,
  });

  // A filled honeypot is answered exactly like success — never tell a bot it was caught.
  if (!parsed.success) return back(request, 'invalid');
  if (parsed.data.company) return back(request, 'ok');

  if (!(await limitByIp('newsletter', request.headers))) {
    return back(request, 'throttled');
  }

  const locale = isLocale(parsed.data.locale) ? parsed.data.locale : DEFAULT_LOCALE;

  try {
    const supabase = await createClient();
    // Security-definer RPC: `newsletter_subscribers` has no insert policy by design
    // (docs/13 §B5), and widening the service-role allowlist was the wrong fix.
    const { data, error } = await supabase.rpc('newsletter_subscribe', {
      p_email: parsed.data.email,
      p_locale: locale,
      p_source: 'footer',
    });

    if (error) {
      logger.warn('Newsletter subscribe failed', { cause: error.message });
      return back(request, 'invalid');
    }

    /*
     * docs/08 §5 — the double opt-in email.
     *
     * Only when there is a token to send. A previously confirmed subscriber keeps
     * `confirm_token = null`, so re-submitting their address writes nothing new and sends
     * nothing — which is also why the response cannot distinguish the two cases.
     */
    const token = (data as { confirm_token?: string | null } | null)?.confirm_token;
    if (token) {
      await sendNewsletterConfirmation({ to: parsed.data.email, token, locale });
    }
  } catch (error) {
    logger.error('Newsletter subscribe threw', {
      cause: error instanceof Error ? error.message : String(error),
    });
    return back(request, 'invalid');
  }

  // Deliberately identical whether the address was new or already present — the response
  // must not reveal whether an email is on the list (docs/05 §15, no enumeration).
  return back(request, 'ok');
}
