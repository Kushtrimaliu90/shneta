import { z } from 'zod';

/**
 * Public, client-safe environment (docs/10 §3). Only `NEXT_PUBLIC_*` lives here.
 *
 * Each variable is read as a *literal* `process.env.NEXT_PUBLIC_X` expression because
 * that is what the Next.js compiler statically inlines — dynamic indexing yields
 * `undefined` in the browser bundle.
 */
const clientSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

export type ClientEnv = z.infer<typeof clientSchema>;

export function parseClientEnv(source: Record<string, string | undefined>): ClientEnv {
  const parsed = clientSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(
      `Invalid public environment. Check these variables against .env.example: ${missing}`,
    );
  }
  return parsed.data;
}

export const clientEnv: ClientEnv = parseClientEnv({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
