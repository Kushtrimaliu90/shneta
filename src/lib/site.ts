import { clientEnv } from '@/lib/env.client';

/**
 * The site's own hostname, for the two places that show it to a person rather than link to it.
 *
 * ── Why this exists ──
 *
 * The domain has moved twice. `biocode.com` was unavailable, so `shtrejt.com` was registered to hold the
 * DNS and the Resend records; the brand later got `biocode.fit`. Each move meant grepping for a string in
 * files nobody thinks of as domain-aware — the SEO preview in the product editor, and the header printed
 * on invoices and packing slips. Both said `shtrejt.com` in a literal, so both were wrong the day after a
 * migration and neither would have failed a test.
 *
 * Everything that *links* somewhere already derives from `NEXT_PUBLIC_SITE_URL`: canonicals, hreflang,
 * `robots.txt`, the sitemap, auth callbacks, email links. These two only *display* it, which is exactly
 * why they were forgotten. One import means the next migration is an environment variable and nothing
 * else — see `runbooks/deploy.md`.
 *
 * ── The parse ──
 *
 * `URL` rather than a regex, so a value with a port, a path or a trailing slash behaves. The `www.` is
 * stripped because these are display strings: an invoice reading `biocode.fit` is what somebody would
 * write on an envelope, and a breadcrumb preview mimics how Google renders a result.
 */
function hostFromSiteUrl(): string {
  try {
    return new URL(clientEnv.NEXT_PUBLIC_SITE_URL).host.replace(/^www\./, '');
  } catch {
    /*
     * Unreachable in a built app — `env.client.ts` validates the variable as a URL and fails the build
     * otherwise. The fallback exists so a malformed override in a scratch environment degrades to the
     * brand name on an invoice instead of throwing inside a print view.
     */
    return 'biocode.fit';
  }
}

/** The bare hostname, no scheme and no `www.` — e.g. `biocode.fit`. */
export const siteHost = hostFromSiteUrl();

/** The full origin, no trailing slash — e.g. `https://biocode.fit`. Prefer this for anything linked. */
export const siteOrigin = clientEnv.NEXT_PUBLIC_SITE_URL;
