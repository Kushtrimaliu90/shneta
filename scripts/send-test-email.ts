/**
 * Sends one real email through Resend, to prove deliverability before launch.
 *
 *   pnpm email:test you@gmail.com
 *   pnpm email:test you@outlook.com --locale=en
 *
 * docs/10 §9 requires "test sends to Gmail/Outlook land in inbox" as a launch-checklist item,
 * and that is not something the suite can assert: whether a message reaches an inbox rather than
 * a spam folder depends on DNS, reputation and the receiving provider, none of which live in this
 * repository. So it is a script a human runs and then goes and looks.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * What this does and does not exercise
 *
 * It uses the **real** `EMAIL_FROM`, the **real** API key and the **real** `emailShell` layout,
 * so what lands in the inbox is branded exactly like an order confirmation and is signed by the
 * same domain. That is the part that determines whether mail is trusted.
 *
 * It deliberately does **not** go through `lib/email/send.ts`: that module is `server-only` and
 * cannot be imported outside a request context. The consequence is that this send is **not**
 * recorded in `email_log`. That is the right trade — a probe is not a business event, and a test
 * row in the log would be indistinguishable from a real one to anyone reading it later.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Safety
 *
 * It refuses to run without an explicit recipient. There is no default address and no fallback
 * to anything read from the database — a script that can email a customer by accident is a
 * script that eventually does.
 */
import { emailShell, plainText } from '../src/lib/email/layout';
import { envFromLocalFile } from '../tests/integration/purge';
import type { Locale } from '../src/lib/constants';

const COPY = {
  sq: {
    subject: 'BIOCODE — provë dërgimi',
    heading: 'Dërgimi funksionon',
    intro:
      'Nëse e ke marrë këtë mesazh në Inbox dhe jo në Spam, domeni dhe të dhënat DNS janë në rregull.',
    footer: 'Ky është një mesazh prove. Nuk kërkohet asnjë veprim.',
  },
  en: {
    subject: 'BIOCODE — delivery test',
    heading: 'Sending works',
    intro:
      'If this arrived in the inbox rather than the spam folder, the domain and its DNS records are set up correctly.',
    footer: 'This is a test message. No action is needed.',
  },
} as const;

function fail(message: string): never {
  console.error(`\nemail:test — ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const to = args.find((arg) => !arg.startsWith('--'));
  const localeArg = args.find((arg) => arg.startsWith('--locale='))?.split('=')[1];
  const locale: Locale = localeArg === 'en' ? 'en' : 'sq';

  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    fail('pass a recipient: pnpm email:test you@example.com [--locale=en]');
  }

  const env = { ...envFromLocalFile(), ...process.env };
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;

  if (!apiKey || !from) {
    fail(
      [
        'RESEND_API_KEY and EMAIL_FROM must both be set — the app treats either one missing as',
        '"no provider" and silently records skipped_no_provider (src/lib/email/send.ts).',
        '',
        'Add to .env.local:',
        '  RESEND_API_KEY=re_…',
        '  EMAIL_FROM="BIOCODE <porosite@biocode.fit>"',
      ].join('\n'),
    );
  }

  const copy = COPY[locale];
  const html = emailShell({
    locale,
    heading: copy.heading,
    intro: copy.intro,
    footer: copy.footer,
  });

  console.log(`\nsending  from ${from}\n           to ${to}\n       locale ${locale}\n`);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: copy.subject,
      html,
      text: plainText({ heading: copy.heading, intro: copy.intro, footer: copy.footer }),
    }),
  });

  const body = await response.text();

  if (!response.ok) {
    /*
     * Resend's errors are the useful kind — it says which of the domain, the key or the From:
     * address it objected to. Printed whole rather than summarised.
     */
    fail(`Resend returned ${response.status}:\n${body}`);
  }

  const id = (JSON.parse(body) as { id?: string }).id;
  console.log(`sent — provider id ${id ?? '(none returned)'}`);
  console.log(
    [
      '',
      'Now go and look, because this only proves Resend accepted it:',
      '  · did it land in the inbox, or in spam?',
      '  · does the sender show as BIOCODE rather than a raw address?',
      '  · in Gmail: "Show original" → SPF, DKIM and DMARC should all read PASS.',
      '',
      'Repeat for at least one Gmail and one Outlook address (docs/10 §9).',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
