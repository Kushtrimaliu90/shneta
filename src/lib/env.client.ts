import { z } from 'zod';

/**
 * Public, client-safe environment (docs/10 §3). Only `NEXT_PUBLIC_*` lives here.
 *
 * Each variable is read as a *literal* `process.env.NEXT_PUBLIC_X` expression because
 * that is what the Next.js compiler statically inlines — dynamic indexing yields
 * `undefined` in the browser bundle.
 */
const clientSchema = z.object({
  /*
   * The origin, with **any trailing slash removed**.
   *
   * Every consumer builds `${origin}/path` — the sitemap, `robots.txt`, every canonical and hreflang tag,
   * the auth callback URLs and the links in fourteen email templates. `z.url()` happily accepts
   * `https://www.example.com/`, and that single character produced a live site advertising
   * `https://www.shtrejt.com//` as the canonical home page, `//shop` in the sitemap, `//en` as the English
   * alternate and `//api/auth/callback` as the address Supabase was asked to redirect to.
   *
   * Normalising here rather than at each of the fifteen call sites: a rule enforced once at the boundary
   * cannot be forgotten by the sixteenth. And normalising rather than *rejecting* a trailing slash, because
   * a value that differs from the intended one by an invisible character should not fail a production
   * deploy — it should mean what the person obviously meant.
   */
  NEXT_PUBLIC_SITE_URL: z.url().transform((value) => value.replace(/\/+$/, '')),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),

  /*
   * Whether to offer "Continue with Google" (docs/05 §15).
   *
   * A flag rather than always-on, because the button is only as good as the provider behind it: with
   * no client ID in Supabase the flow reaches Google and comes back an error, and the visitor blames
   * the shop rather than the configuration. So the code ships dark and the switch is flipped once
   * Supabase → Auth → Providers → Google holds real credentials.
   *
   * Optional and defaulting to off, so no existing deployment fails a build over a variable it has
   * never heard of. Any value other than 'true' means off — a half-set flag should not half-enable a
   * sign-in path.
   */
  NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
});

export type ClientEnv = z.infer<typeof clientSchema>;

/**
 * An example of a valid value per variable, shown when one fails.
 *
 * The message used to say "check these against .env.example", which is fine on a laptop and
 * useless in a Vercel build log — the person reading it is in a browser, on a settings page, with
 * no repository in front of them. A build that fails on configuration should say what the
 * configuration ought to look like.
 */
const EXAMPLES: Record<keyof ClientEnv, string> = {
  NEXT_PUBLIC_SITE_URL:
    'https://www.example.com (the scheme is required — a bare host is rejected)',
  NEXT_PUBLIC_SUPABASE_URL: 'https://<project-ref>.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'the anon key from Supabase → Settings → API',
  NEXT_PUBLIC_GOOGLE_AUTH_ENABLED:
    "'true' once Supabase → Auth → Providers → Google has a client ID; omit it otherwise",
};

export function parseClientEnv(source: Record<string, string | undefined>): ClientEnv {
  const parsed = clientSchema.safeParse(source);
  if (!parsed.success) {
    /*
     * Names and reasons, never values. This text lands in build logs, which are shared in
     * screenshots and issue threads far more casually than a `.env` file ever is — and while
     * these three are public by design, "public" and "worth pasting into a chat" are different
     * things. Saying a variable is absent or malformed is enough to fix it.
     */
    const detail = parsed.error.issues
      .map((issue) => {
        const name = issue.path.join('.') as keyof ClientEnv;
        const reason =
          source[name] === undefined || source[name] === '' ? 'not set' : issue.message;
        return `  · ${name} — ${reason}\n    expected: ${EXAMPLES[name] ?? 'see .env.example'}`;
      })
      .join('\n');

    throw new Error(
      `Invalid public environment:\n${detail}\n\n` +
        'These are read at BUILD time, so setting them in a hosting dashboard takes effect on ' +
        'the next deploy, not the current one.',
    );
  }
  return parsed.data;
}

export const clientEnv: ClientEnv = parseClientEnv({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED,
});
