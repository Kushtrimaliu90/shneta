/**
 * Addresses that can never receive mail, and must therefore never be sent to.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Why this exists
 *
 * Every E2E run creates users at `@biocode.test` and places real orders, which calls
 * `sendOrderLifecycleEmail`. That was harmless for eleven milestones because no provider was
 * configured and every send recorded `skipped_no_provider`. The moment a real `RESEND_API_KEY`
 * landed, one `pnpm test:e2e` became **dozens of messages posted to a domain that does not
 * resolve** — and an address that cannot resolve is a hard bounce, every time.
 *
 * Hard-bounce rate is the single fastest way to destroy a new sending domain's reputation.
 * Providers suspend accounts over it, and the damage is not undone by stopping: `biocode.fit`
 * would arrive at launch already distrusted, with every order confirmation going to spam.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Why a property of the address, not a flag
 *
 * The obvious fix is `EMAIL_DISABLED=true` in the test environment. It is worse: it has to be
 * remembered, it is absent from a fresh clone, and it fails open — forget it once and the
 * bounces happen anyway. These TLDs are reserved by RFC 2606 and RFC 6761 precisely so that they
 * can never be delegated, so "mail to `.test` is a mistake" is true everywhere, forever, with no
 * configuration to get wrong.
 */

/**
 * RFC 2606 §2 and RFC 6761 §6 — reserved for documentation and testing, never resolvable.
 *
 * `.local` is deliberately absent: it is mDNS, not reserved for documentation, and a corporate
 * intranet can legitimately deliver to it.
 */
const UNDELIVERABLE_TLDS = ['test', 'invalid', 'example', 'localhost'] as const;

/**
 * RFC 2606 §3 — reserved second-level domains. Distinct from the TLD list because `example.com`
 * is a real registration held by IANA specifically so that nobody can use it.
 */
const UNDELIVERABLE_DOMAINS = ['example.com', 'example.net', 'example.org'] as const;

/**
 * True when the address is guaranteed undeliverable and sending would only produce a bounce.
 *
 * Case- and whitespace-insensitive, and tolerant of a display name (`Name <a@b.test>`), because
 * this is the last check before a network call and the input has come through several layers.
 */
/**
 * Where operational alerts go: the new-order email and the merchant-progress notices.
 *
 * `settings.store.opsEmail`, falling back to `settings.store.email` — both edited in
 * /admin/settings, so the inbox changes without a deploy. Read with the service client because
 * the callers run where there is no useful session: the checkout action (a customer, or a
 * guest), a merchant's fulfilment action, and the housekeeping cron — all sanctioned email
 * dispatch per docs/02 §6. Returns null when neither address is set or the address could never
 * be delivered to; callers skip the send rather than bounce it.
 */
export async function getOpsAlertRecipient(): Promise<string | null> {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const admin = createAdminClient();
  const { data } = await admin.from('settings').select('value').eq('key', 'store').maybeSingle();

  const store =
    data?.value && typeof data.value === 'object' && !Array.isArray(data.value)
      ? (data.value as Record<string, unknown>)
      : {};

  const candidate =
    (typeof store.opsEmail === 'string' && store.opsEmail.trim()) ||
    (typeof store.email === 'string' && store.email.trim()) ||
    '';

  if (!candidate || isUndeliverableRecipient(candidate)) return null;
  return candidate;
}

export function isUndeliverableRecipient(recipient: string): boolean {
  // `angled?.[1]` rather than `angled[1]`: under `noUncheckedIndexedAccess` a capture group is
  // `string | undefined` even when the match succeeded, and the compiler is right to insist.
  const address = (recipient.match(/<([^>]+)>/)?.[1] ?? recipient).trim().toLowerCase();

  const at = address.lastIndexOf('@');
  if (at === -1) return true; // Not an address at all — nothing good happens by sending it.

  const domain = address.slice(at + 1);
  if (!domain) return true;

  if ((UNDELIVERABLE_DOMAINS as readonly string[]).includes(domain)) return true;

  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return (UNDELIVERABLE_TLDS as readonly string[]).includes(tld);
}
