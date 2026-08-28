import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { enabledOAuthProviders } from '@/features/auth/oauth';
import { clientEnv } from '@/lib/env.client';

/**
 * The social sign-in block, shared by sign-in and sign-up (docs/05 §15).
 *
 * A plain `<a>` per provider, not a button: it needs no JavaScript and it is a navigation rather than a
 * form submission, which is what keeps `form-action 'self'` in the CSP intact. The reasoning is in
 * `features/auth/oauth.ts`.
 *
 * Note it is **not** localized through `Link` from `@/i18n/routing` — the href is an `/api` path, and
 * `/api` is in the middleware's unlocalized list. Routing it through the locale-aware `Link` would
 * produce `/sq/api/auth/oauth`, which does not exist. The two links to the legal pages *do* use it,
 * because those are storefront routes and a visitor reading Albanian should stay in Albanian.
 *
 * ── The terms notice is a compliance requirement, not decoration ──
 *
 * `signUpSchema` enforces `terms: z.literal('on')` because docs/05 §15 requires acceptance to be
 * explicit. A social sign-up never sees that checkbox, so without this line the site would be creating
 * accounts on terms the customer was never shown — in a regulated category, selling supplements. The
 * notice is stated before the button rather than after it, so it is read before the decision.
 */
export async function OAuthButtons({ next }: { next?: string }) {
  /*
   * Nothing at all when no provider is configured — not an empty divider with a terms notice under it.
   * The flag exists so this code can ship before the Google credentials do (see `env.client.ts`).
   */
  const providers = enabledOAuthProviders({ google: clientEnv.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED });
  if (providers.length === 0) return null;

  const t = await getTranslations('auth.oauth');

  const query = new URLSearchParams();
  if (next) query.set('next', next);

  return (
    <div className="flex flex-col gap-4">
      {/*
        A rule with the word inside it. `aria-hidden` on the whole thing: it separates two ways of
        doing the same task, and "or" announced between two labelled controls is noise.
      */}
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="eyebrow">{t('divider')}</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="flex flex-col gap-2.5">
        {providers.map((provider) => {
          const params = new URLSearchParams(query);
          params.set('provider', provider);
          return (
            <a
              key={provider}
              href={`/api/auth/oauth?${params.toString()}`}
              /*
               * Google's brand guidelines require their mark at its official colours on a white or
               * black surface, and the label to read "Sign in with Google" in the user's language.
               * `min-h-12` matches the `lg` button size the email form uses, so the two do not look
               * like different generations of the page.
               */
              className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-md border border-line-strong bg-surface px-4 text-[15px] font-medium text-ink-900 transition-colors hover:bg-forest-50"
            >
              <GoogleMark />
              {t('google')}
            </a>
          );
        })}
      </div>

      <p className="text-[13px] leading-relaxed text-ink-600">
        {t.rich('terms', {
          terms: (chunks) => (
            <Link href="/legal/terms" className="text-forest-700 underline underline-offset-4">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href="/legal/privacy" className="text-forest-700 underline underline-offset-4">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}

/**
 * The official Google "G", inlined.
 *
 * Inline rather than a file in `public/`: it is four paths, it must not be recoloured to fit the brand
 * palette (Google's terms forbid it, which is also why these are literal hex values and not design
 * tokens — CLAUDE.md §9 governs *our* colours), and inlining spares the LCP path a request on a page
 * whose whole job is to load fast and be trusted.
 */
function GoogleMark() {
  return (
    <svg className="size-5 shrink-0" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
