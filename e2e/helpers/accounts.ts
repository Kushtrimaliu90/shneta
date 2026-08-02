import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Test accounts and the service client, shared by every spec that needs a signed-in user.
 *
 * Extracted from `admin.spec.ts` when the M7 journeys needed the same three things — a user
 * with a role, a sign-in, and a service client to assert against. Copying them would have meant
 * three definitions of "make a staff user" drifting apart, and the E2E teardown only deletes
 * what matches the `@biocode.test` convention these enforce.
 */

export function env(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match?.[1] && match[2] !== undefined) out[match[1]] = match[2].trim();
    }
  } catch {
    /* CI supplies these through process.env */
  }
  return { ...out, ...(process.env as Record<string, string>) };
}

const { NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY } = env();

const service: SupabaseClient | null =
  URL_ && KEY ? createClient(URL_, KEY, { auth: { persistSession: false } }) : null;

/**
 * The service client, narrowed once — non-null assertions are banned (CLAUDE.md §1), and a
 * named throw reports the real problem when the credentials are genuinely absent.
 */
export function db(): SupabaseClient {
  if (!service) throw new Error('Service credentials missing; cannot run this suite.');
  return service;
}

export type StaffRole =
  | 'support'
  | 'warehouse_manager'
  | 'product_manager'
  | 'content_manager'
  | 'compliance_manager'
  | 'admin'
  | 'customer';

/** Every user this process created, so `afterAll` can remove them. */
export const createdUsers: string[] = [];

export async function deleteCreatedUsers(): Promise<void> {
  for (const id of createdUsers) await service?.auth.admin.deleteUser(id);
  createdUsers.length = 0;
}

/**
 * Creates a confirmed user and sets its role through the service client.
 *
 * Minted per test rather than signing in as the `@biocode.dev` seed accounts: the suite then
 * works on a database where `pnpm seed:users` has never run, needs no shared password, and one
 * test cannot disturb another's account. `@biocode.test` on every address, which is the only
 * pattern `purgeFixtures` deletes.
 */
export async function staffUser(role: StaffRole): Promise<{ email: string; password: string }> {
  const client = db();

  const email = `e2e-${role}-${randomUUID()}@biocode.test`;
  const password = `Pw-${randomUUID()}`;

  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `E2E ${role}` },
  });
  if (error || !data.user) throw new Error(`fixture staff user failed: ${error?.message}`);
  createdUsers.push(data.user.id);

  if (role !== 'customer') {
    // `handle_new_user` defaults to `customer`; the service role is exempt from
    // `prevent_role_escalation` (docs/13 §A4), which is what makes this possible.
    const { error: roleError } = await client
      .from('profiles')
      .update({ role })
      .eq('id', data.user.id);
    if (roleError) throw new Error(`role assignment failed: ${roleError.message}`);
  }

  return { email, password };
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/en/auth/sign-in');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The action redirects on success; waiting on the URL leaving /auth is the reliable signal.
  await expect(page).not.toHaveURL(/\/auth\/sign-in/, { timeout: 30_000 });
}

/**
 * Reserves a documentation IP block for a spec file and hands out one address per test.
 *
 * docs/02 §9 limits sign-in to 5 attempts per 15 minutes per IP, and these specs sign in once
 * per test — so without this, the sixth test in a file fails for a reason that has nothing to do
 * with what it is testing. Two specs sharing a block is the same bug one step removed, which is
 * why the allocation is written down:
 *
 *   · 203.0.113 and 198.51.100 — auth.spec.ts (the rate-limiter test needs its own)
 *   · 192.0.2                  — checkout.spec.ts
 *   · 233.252.0                — admin.spec.ts
 *   · 233.252.1                — account.spec.ts
 *   · 233.252.2                — reviews.spec.ts
 *   · 233.252.3                — discovery.spec.ts
 *
 * 233.252.x is MCAST-TEST-NET: reserved, never routable, and therefore as safe as TEST-NET for a
 * value that only ever appears in an `x-forwarded-for` header.
 */
export function ipAllocator(block: string) {
  let counter = 0;

  return {
    /** Clears the block's rate-limit buckets. Call from `beforeAll`. */
    async reset(): Promise<void> {
      await service?.from('rate_limits').delete().like('key', `%:${block}.%`);
    },
    /** The next address in the block, spread across workers. */
    next(workerIndex: number): string {
      counter += 1;
      return `${block}.${((workerIndex * 50 + counter) % 250) + 1}`;
    },
  };
}
