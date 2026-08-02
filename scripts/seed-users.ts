/**
 * Creates the fixture auth users and assigns their staff roles (docs/11 §2).
 *
 *   pnpm seed:users                 # create/repair, print the password once
 *   pnpm seed:users --password=…    # use a known password (CI, shared dev box)
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Why a script and not `seed.sql`
 *
 * Auth users live in the `auth` schema, which is Supabase's, not ours. Inserting there
 * directly skips the password hashing, identity rows and confirmation bookkeeping that
 * `auth.admin.createUser` does, and the shapes change between Supabase versions. So the
 * users come from the Admin API and `seed.sql` references their **fixed UUIDs** — which is
 * why docs/11 §10 requires this to run first.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Roles
 *
 * `handle_new_user` creates the profile with the default `customer` role, so each staff role
 * is a follow-up update. That update is normally blocked by `prevent_role_escalation`, which
 * exempts the service role explicitly (docs/13 §A4) — this script is one of the two flows
 * that exemption exists for.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Passwords
 *
 * One password for all seven accounts, generated at random and printed **once**. Not stored,
 * not committed, not recoverable — re-run with `--reset-password` to mint a new one. The
 * accounts are `@biocode.dev`, which docs/11 scopes to local and staging.
 *
 * The guard is the same one the test suites use: it refuses to run unless
 * `SUPABASE_TEST_PROJECT` names the target. Creating a user called `admin@biocode.dev` with a
 * printed-to-console password on a database serving real customers is precisely the kind of
 * thing that must not be one careless `.env.local` away.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { assertPurgeable, envFromLocalFile } from '../tests/integration/purge';

/**
 * Fixed UUIDs so `seed.sql` and the demo fixtures can reference them. The `e0…` block is
 * reserved for users, alongside `a0…` ingredients, `b0…` products and `d0…` coupons.
 */
const USERS = [
  {
    id: 'e0000000-0000-4000-8000-000000000001',
    email: 'admin@biocode.dev',
    role: 'admin',
    name: 'Admin BIOCODE',
  },
  {
    id: 'e0000000-0000-4000-8000-000000000002',
    email: 'pm@biocode.dev',
    role: 'product_manager',
    name: 'Produkt Menaxher',
  },
  {
    id: 'e0000000-0000-4000-8000-000000000003',
    email: 'content@biocode.dev',
    role: 'content_manager',
    name: 'Content Menaxher',
  },
  {
    id: 'e0000000-0000-4000-8000-000000000004',
    email: 'support@biocode.dev',
    role: 'support',
    name: 'Suport BIOCODE',
  },
  {
    id: 'e0000000-0000-4000-8000-000000000005',
    email: 'depo@biocode.dev',
    role: 'warehouse_manager',
    name: 'Depo BIOCODE',
  },
  {
    id: 'e0000000-0000-4000-8000-000000000006',
    email: 'compliance@biocode.dev',
    role: 'compliance_manager',
    name: 'Compliance BIOCODE',
  },
  {
    id: 'e0000000-0000-4000-8000-000000000007',
    email: 'klienti@biocode.dev',
    role: 'customer',
    name: 'Klienti Provë',
  },
] as const;

function generatePassword(): string {
  // 24 base64url chars ≈ 144 bits. Well past the 8-character floor in `passwordSchema`, and
  // it needs no composition rules to be strong (NIST 800-63B — see the schema's note).
  return `Sh-${randomBytes(18).toString('base64url')}`;
}

interface Outcome {
  email: string;
  role: string;
  action: 'created' | 'password reset' | 'email updated' | 'already existed';
  roleChanged: boolean;
}

async function upsertUser(
  db: SupabaseClient,
  user: (typeof USERS)[number],
  password: string,
  resetPassword: boolean,
): Promise<Outcome> {
  let action: Outcome['action'] = 'created';

  const { error: createError } = await db.auth.admin.createUser({
    // Supplying the id keeps `seed.sql`'s references valid across a re-run.
    id: user.id,
    email: user.email,
    password,
    // Confirmed outright: these are fixtures, and there is no inbox to click a link in.
    email_confirm: true,
    user_metadata: { full_name: user.name },
  });

  if (createError) {
    // Anything other than "already there" is a real failure and must not be swallowed.
    if (!/already|registered|exists|duplicate/i.test(createError.message)) {
      throw new Error(`${user.email}: ${createError.message}`);
    }

    action = 'already existed';

    if (resetPassword) {
      const { error } = await db.auth.admin.updateUserById(user.id, { password });
      if (error) throw new Error(`${user.email}: ${error.message}`);
      action = 'password reset';
    }

    /*
     * Reconcile the address, not just the password.
     *
     * These are created **by fixed id**, so a re-run after the address changes hits
     * "already exists" and returns — leaving the account on its old email while this script
     * reports the new one. The BIOCODE rebrand is exactly that case: six `@shneta.dev`
     * accounts that `seed:users` would have gone on claiming were `@biocode.dev` forever.
     *
     * Read-then-write so the common case (nothing changed) costs no write and the output
     * stays honest about what actually happened.
     */
    const { data: current } = await db.auth.admin.getUserById(user.id);
    if (current.user && current.user.email !== user.email) {
      const { error } = await db.auth.admin.updateUserById(user.id, {
        email: user.email,
        email_confirm: true,
      });
      if (error) throw new Error(`${user.email} rename: ${error.message}`);

      // `profiles.email` is populated by `handle_new_user` at insert and does not follow.
      const { error: profileError } = await db
        .from('profiles')
        .update({ email: user.email })
        .eq('id', user.id);
      if (profileError) throw new Error(`${user.email} profile rename: ${profileError.message}`);

      action = 'email updated';
    }
  }

  /*
   * The profile arrives via `handle_new_user`, but read-then-write rather than assuming:
   * on a re-run the row already exists, and reporting "role changed" only when it actually
   * changed makes a repeat run's output honest instead of uniformly green.
   */
  const { data: existing, error: readError } = await db
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle();

  if (readError) throw new Error(`${user.email} profile: ${readError.message}`);
  if (!existing) throw new Error(`${user.email}: no profile row — did handle_new_user fire?`);

  const current = existing as { role: string; full_name: string };
  const roleChanged = current.role !== user.role;

  if (roleChanged || current.full_name !== user.name) {
    const { error } = await db
      .from('profiles')
      .update({ role: user.role, full_name: user.name })
      .eq('id', user.id);
    // Exempted from prevent_role_escalation because this is the service role (docs/13 §A4).
    if (error) throw new Error(`${user.email} role: ${error.message}`);
  }

  return { email: user.email, role: user.role, action, roleChanged };
}

async function main(): Promise<void> {
  const env = { ...envFromLocalFile(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!url || !key) {
    console.error('Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  // Same gate as the test suites: fixture accounts with a printed password have no business
  // existing on a database that serves customers (docs/14 §7).
  assertPurgeable(url);

  const explicit = process.argv.find((arg) => arg.startsWith('--password='))?.split('=')[1];
  const resetPassword = process.argv.includes('--reset-password') || Boolean(explicit);
  const password = explicit || generatePassword();

  console.log(`Seeding ${USERS.length} fixture users into ${url}\n`);

  const outcomes: Outcome[] = [];
  for (const user of USERS) {
    // Sequential rather than parallel: `createUser` writes to auth.users and profiles via a
    // trigger, and a failure part-way through is far easier to read one line at a time.
    outcomes.push(await upsertUser(db(url, key), user, password, resetPassword));
  }

  for (const outcome of outcomes) {
    const note = outcome.roleChanged ? ' · role set' : '';
    console.log(
      `  ${outcome.email.padEnd(24)} ${outcome.role.padEnd(19)} ${outcome.action}${note}`,
    );
  }

  const created = outcomes.filter((o) => o.action !== 'already existed').length;

  if (created > 0 || explicit) {
    console.log(`\n  Password for all ${USERS.length} accounts:\n\n      ${password}\n`);
    console.log('  Printed once and not stored anywhere. Save it now, or re-run with');
    console.log('  --reset-password to mint a new one.');
  } else {
    console.log('\n  All accounts already existed; passwords left alone.');
    console.log('  Re-run with --reset-password if you need a new one.');
  }

  console.log('\n  Sign in to the admin panel at /en/auth/sign-in, then open /admin.');
}

// A single client, created lazily so the guard above runs before any connection is opened.
let client: SupabaseClient | null = null;
function db(url: string, key: string): SupabaseClient {
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

main().catch((error: unknown) => {
  console.error(`\nseed:users failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
