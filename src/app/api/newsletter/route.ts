import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { limitByIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { isLocale, DEFAULT_LOCALE } from '@/lib/constants';

/**
 * docs/08 §5 — newsletter opt-in.
 *
 * A route handler rather than a server action because the footer form must work without
 * JavaScript (it is a plain `<form method="post">`), and the shipped shell already points
 * at this path. Until this existed the form returned a 500 on the deployed site.
 *
 * The double opt-in *email* lands with M8, when Resend is wired. The row and its confirm
 * token are written now, so nobody is silently dropped in the meantime: M8 can mail every
 * subscriber whose `confirmed_at` is still null.
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
    const { error } = await supabase.rpc('newsletter_subscribe', {
      p_email: parsed.data.email,
      p_locale: locale,
      p_source: 'footer',
    });

    if (error) {
      logger.warn('Newsletter subscribe failed', { cause: error.message });
      return back(request, 'invalid');
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
