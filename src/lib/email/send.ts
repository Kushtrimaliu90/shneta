import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env.server';
import { logger } from '@/lib/logger';

/**
 * docs/08 §6 — every send goes through here and is logged to `email_log`.
 *
 * **Degrades instead of failing.** Without `RESEND_API_KEY` the message is recorded with
 * status `skipped_no_provider` and nothing is sent. That is deliberate: docs/07 §12 says a
 * failed email must never block the commerce transaction, and the same must hold for an
 * unconfigured one. An order still completes on a machine with no email account, and the log
 * shows exactly which confirmations were never delivered — so they can be replayed once the
 * sending domain is verified, rather than being lost.
 *
 * The service client is the sanctioned path for email dispatch logging (docs/02 §6).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Template identifier, for the log and for later replay. */
  template: string;
  orderId?: string;
}

export type SendResult =
  | { status: 'sent'; providerId: string | null }
  | { status: 'skipped_no_provider' }
  | { status: 'failed'; error: string };

async function record(
  message: EmailMessage,
  status: string,
  providerId: string | null,
  error: string | null,
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('email_log').insert({
      to_email: message.to,
      template: message.template,
      subject: message.subject,
      status,
      provider_id: providerId,
      error,
      order_id: message.orderId ?? null,
    });
  } catch (cause) {
    // Losing the log entry must not lose the email or fail the caller.
    logger.error('email_log write failed', {
      template: message.template,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const apiKey = serverEnv.RESEND_API_KEY;
  const from = serverEnv.EMAIL_FROM;

  if (!apiKey || !from) {
    logger.warn('Email skipped — no provider configured', {
      template: message.template,
      to: message.to.replace(/(.).*(@.*)/, '$1***$2'),
    });
    await record(message, 'skipped_no_provider', null, null);
    return { status: 'skipped_no_provider' };
  }

  try {
    /*
     * Called over HTTP rather than through the `resend` SDK: the payload is four fields, and
     * this keeps the dependency out of the server bundle for a request we can express in ten
     * lines. Swap in the SDK when attachments or batching are needed.
     */
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      logger.error('Resend rejected the message', {
        template: message.template,
        status: response.status,
      });
      await record(message, 'failed', null, `${response.status}: ${detail.slice(0, 300)}`);
      return { status: 'failed', error: `HTTP ${response.status}` };
    }

    const body = (await response.json()) as { id?: string };
    await record(message, 'sent', body.id ?? null, null);
    logger.info('Email sent', { template: message.template, providerId: body.id });
    return { status: 'sent', providerId: body.id ?? null };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    logger.error('Email send threw', { template: message.template, cause: error });
    await record(message, 'failed', null, error.slice(0, 300));
    return { status: 'failed', error };
  }
}
