import 'server-only';
import { z } from 'zod';
import { clientEnv } from '@/lib/env.client';

/**
 * Server-only environment (docs/10 §3). Importing this module from a client component is a
 * build error thanks to `server-only` — that boundary is why the env is split in two
 * (docs/13 §F2): a single module touching SUPABASE_SERVICE_ROLE_KEY would drag the secret
 * into any bundle that imported it.
 *
 * Variables that are only needed once a later milestone lands are optional here and asserted
 * at their point of use, so M0–M3 boot without an email or Sentry account.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  // M4+ — email infrastructure.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),

  // M9+ / M11 — cron and on-demand ISR.
  CRON_SECRET: z.string().min(16).optional(),
  REVALIDATE_SECRET: z.string().min(16).optional(),

  // Observability.
  SENTRY_DSN: z.string().optional(),

  /*
   * Search-engine indexing, **off unless explicitly switched on**.
   *
   * The default is the unusual part and it is deliberate. On 8 Aug 2026 the project paused itself on
   * a spend limit; the day's bill was $7.02, 85 % of it in four line items that are all the same
   * event — a page being generated on the server — and the only thing generating them was crawler
   * traffic against a shop with no customers. robots.ts had already been narrowed once for the same
   * reason (4.8M of 4.9M PostgREST requests over 5.6 days were the faceted listing query).
   *
   * A fail-open default would mean one unset variable in one environment quietly restores the bill.
   * Fail-closed costs a launch-day step instead, which is on the checklist in docs/14 §20 and is
   * cheap to get wrong in the recoverable direction: a day unindexed is survivable, a month of
   * crawler spend on placeholder pages is not.
   */
  SEO_INDEXING: z.enum(['on', 'off']).default('off'),

  // Post-v1 — bank virtual POS (docs/07 §6.3).
  BANK_POS_MERCHANT_ID: z.string().optional(),
  BANK_POS_SECRET: z.string().optional(),
  BANK_POS_BASE_URL: z.url().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const parsed = serverSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid server environment. Check .env.example: ${missing}`);
  }
  return parsed.data;
}

const parsedServerEnv = parseServerEnv(process.env);

export const serverEnv = { ...parsedServerEnv, ...clientEnv };

/**
 * Asserts a variable that is optional at boot but mandatory for a specific feature, so the
 * failure names the feature instead of surfacing as `undefined` deep inside a provider call.
 */
export function requireEnv<K extends keyof ServerEnv>(
  key: K,
  feature: string,
): NonNullable<ServerEnv[K]> {
  const value = parsedServerEnv[key];
  if (value == null || value === '') {
    throw new Error(`${String(key)} is required for ${feature} but is not set.`);
  }
  return value as NonNullable<ServerEnv[K]>;
}
