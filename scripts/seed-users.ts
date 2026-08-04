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
 * One password, generated at random and printed **once** — for the accounts it is actually the
 * password of. A run that creates two accounts and leaves seven alone says so and names the two;
 * `--reset-password` puts every account on one password. Not stored, not committed, not
 * recoverable. The accounts are `@biocode.dev`, which docs/11 scopes to local and staging.
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

  /*
   * The two marketplace logins (docs/16 §5).
   *
   * `merchantId` links the profile into `merchant_users`, which is what `current_merchant_ids()`
   * reads and therefore what every merchant-side policy depends on. **The `merchant` role alone
   * grants nothing** — it is what keeps a merchant out of `/admin`, not what lets them into the
   * portal — so a fixture with the role and no membership would sign in to a redirect.
   *
   * Two of them, because one cannot show the difference that matters: Alpha is approved and has
   * offers, a ledger and a paid statement, while Gamma is a pending application whose portal opens
   * with Orders, Offers, Bulk and Proposals visibly locked. Seeing both is how you know the gate is
   * real rather than absent.
   */
  {
    id: 'e0000000-0000-4000-8000-000000000008',
    email: 'alpha@biocode.dev',
    role: 'merchant',
    name: 'Arta Krasniqi (Alpha Supplements)',
    merchantId: 'd1000000-0000-4000-8000-000000000001',
  },
  {
    id: 'e0000000-0000-4000-8000-000000000009',
    email: 'gamma@biocode.dev',
    role: 'merchant',
    name: 'Drita Berisha (Gamma Vitamins)',
    merchantId: 'd1000000-0000-4000-8000-000000000003',
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
  created: boolean;
  /** True when the printed password is this account's password — created, or explicitly reset. */
  passwordSet: boolean;
  emailUpdated: boolean;
  roleChanged: boolean;
  /** For the marketplace fixtures: whether the `merchant_users` link could be made. */
  membership?: 'linked' | 'merchant missing';
}

/**
 * A readable line from a GoTrue error.
 *
 * `AuthRetryableFetchError.message` is the response body run through `JSON.stringify`, so an empty
 * body arrives as the literal string `{}` — which is what turned a fixable rename into
 * `seed:users failed: klienti@biocode.dev: {}`, a message with nothing in it to act on. The name and
 * the status are always there and always say more than that.
 */
function describeAuthError(error: { name: string; message: string; status?: number }): string {
  const body = error.message && error.message !== '{}' ? error.message : '(empty response body)';
  return `${error.name}${error.status ? ` ${error.status}` : ''} — ${body}`;
}

/**
 * Creates or reconciles one fixture account.
 *
 * ── Existence is decided by id, not by what `createUser` says about it ──
 *
 * These accounts are created **by fixed id** so `seed.sql` can reference them, and that makes
 * `createUser` the wrong question to ask second time round. GoTrue answers a duplicate *email* with a
 * clean 422 that says "already been registered", but a duplicate *id* with **500 and an empty body** —
 * so the earlier check, which sniffed the message for `/already|exists|duplicate/`, correctly handled
 * the re-run where nothing had changed and threw on the one case that needed the work: an account whose
 * address this script has since changed. That is docs/13 §X14.
 *
 * So: look the id up, then create or reconcile. A `createUser` failure now means something real — the
 * id was free and the **email** was not, i.e. it belongs to a different account — and says so.
 */
async function upsertUser(
  db: SupabaseClient,
  user: (typeof USERS)[number],
  password: string,
  resetPassword: boolean,
): Promise<Outcome> {
  /*
   * A missing id answers `404 · User not found`. Keyed on the **status**, with the text as a fallback —
   * sniffing an API's English is the habit that produced the bug this function was rewritten for.
   */
  const { data: found, error: lookupError } = await db.auth.admin.getUserById(user.id);
  if (lookupError) {
    const missing =
      (lookupError as { status?: number }).status === 404 || /not.?found/i.test(lookupError.message);
    if (!missing) throw new Error(`${user.email} lookup: ${describeAuthError(lookupError)}`);
  }

  const account = found?.user ?? null;
  let created = false;
  let passwordSet = false;
  let emailUpdated = false;

  if (!account) {
    const { error } = await db.auth.admin.createUser({
      // Supplying the id keeps `seed.sql`'s references valid across a re-run.
      id: user.id,
      email: user.email,
      password,
      // Confirmed outright: these are fixtures, and there is no inbox to click a link in.
      email_confirm: true,
      user_metadata: { full_name: user.name },
    });

    // The id was free, so this is the address being taken by some *other* account.
    if (error) throw new Error(`${user.email}: ${describeAuthError(error)}`);
    created = true;
    passwordSet = true;
  } else {
    if (resetPassword) {
      const { error } = await db.auth.admin.updateUserById(user.id, { password });
      if (error) throw new Error(`${user.email}: ${describeAuthError(error)}`);
      passwordSet = true;
    }

    /*
     * Reconcile the address, not just the password.
     *
     * The BIOCODE rebrand is why this exists: six `@shneta.dev` accounts that `seed:users` would
     * otherwise have gone on claiming were `@biocode.dev` forever. Read-then-write, so the common case
     * (nothing changed) costs no write and the output stays honest about what actually happened.
     */
    if (account.email !== user.email) {
      const { error } = await db.auth.admin.updateUserById(user.id, {
        email: user.email,
        email_confirm: true,
      });
      if (error) throw new Error(`${user.email} rename: ${describeAuthError(error)}`);

      // `profiles.email` is populated by `handle_new_user` at insert and does not follow.
      const { error: profileError } = await db
        .from('profiles')
        .update({ email: user.email })
        .eq('id', user.id);
      if (profileError) throw new Error(`${user.email} profile rename: ${profileError.message}`);

      emailUpdated = true;
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

  /*
   * The marketplace membership.
   *
   * Deliberately tolerant of the merchant row being absent, because of the ordering docs/11 §10
   * requires: this script runs **before** `seed.sql` and `seeds/`, so on a fresh `supabase db reset`
   * the demo merchants do not exist yet. Reporting "merchant missing" and carrying on beats failing
   * the whole run — re-run after the seed and the link completes.
   */
  let membership: Outcome['membership'];
  const merchantId = 'merchantId' in user ? user.merchantId : undefined;

  if (merchantId) {
    const { data: merchant } = await db
      .from('merchants')
      .select('id')
      .eq('id', merchantId)
      .maybeSingle();

    if (!merchant) {
      membership = 'merchant missing';
    } else {
      const { error } = await db
        .from('merchant_users')
        .upsert({ merchant_id: merchantId, user_id: user.id, role: 'owner' });
      if (error) throw new Error(`${user.email} membership: ${error.message}`);
      membership = 'linked';
    }
  }

  return {
    email: user.email,
    role: user.role,
    created,
    passwordSet,
    emailUpdated,
    roleChanged,
    membership,
  };
}

/** What happened to one account, for the report. */
function describe(outcome: Outcome): string {
  const parts: string[] = [];
  if (outcome.created) parts.push('created');
  else parts.push('already existed');
  if (outcome.passwordSet && !outcome.created) parts.push('password reset');
  if (outcome.emailUpdated) parts.push('email updated');
  if (outcome.roleChanged) parts.push('role set');
  if (outcome.membership) parts.push(outcome.membership);
  return parts.join(' · ');
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
    console.log(
      `  ${outcome.email.padEnd(24)} ${outcome.role.padEnd(19)} ${describe(outcome)}`,
    );
  }

  if (outcomes.some((outcome) => outcome.membership === 'merchant missing')) {
    console.log('\n  A merchant fixture has no row yet — apply');
    console.log('  supabase/seeds/10-marketplace-demo.sql, then run this again to link it.');
  }

  /*
   * The password is printed for the accounts it is **actually** the password of.
   *
   * A partial run is the normal case, not the exception: adding the two merchant fixtures to a project
   * that already had seven meant one new password and seven untouched ones. Printing it under "password
   * for all 9 accounts" would have been wrong in the way that costs somebody twenty minutes — so the
   * accounts it applies to are named, and the rest are stated as unchanged.
   */
  const withPassword = outcomes.filter((outcome) => outcome.passwordSet);

  if (withPassword.length === 0) {
    console.log('\n  Every account already existed; passwords left alone.');
    console.log('  Re-run with --reset-password if you need a new one.');
  } else {
    const all = withPassword.length === outcomes.length;
    console.log(
      all
        ? `\n  Password for all ${outcomes.length} accounts:\n\n      ${password}\n`
        : `\n  Password for ${withPassword.length} of ${outcomes.length} accounts:\n\n      ${password}\n`,
    );
    if (!all) {
      for (const outcome of withPassword) console.log(`      · ${outcome.email}`);
      console.log('\n  The others kept the password they already had. Re-run with --reset-password');
      console.log('  to put every account on one password.');
    } else {
      console.log('  Printed once and not stored anywhere. Save it now, or re-run with');
      console.log('  --reset-password to mint a new one.');
    }
  }

  console.log('\n  Sign in at /en/auth/sign-in, then:');
  console.log('    · staff             → /admin');
  console.log('    · alpha@biocode.dev → /en/merchant   approved: offers, orders, payouts');
  console.log('    · gamma@biocode.dev → /en/merchant   pending: only documents and settings');
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
