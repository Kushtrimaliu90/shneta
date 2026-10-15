/**
 * CI only — point `.env.local` at the keys the local Supabase stack actually honours.
 *
 * ── Why this exists ──
 *
 * `supabase start` on CLI 2.110 prints the new `sb_publishable_…` / `sb_secret_…` keys, while
 * `.env.example` carries the legacy JWT demo keys. Two CI runs in October 2026 showed that with
 * *either* pair copied straight into `.env.local`, GoTrue accepted the service key (users were
 * created) but PostgREST ran the same requests as the anonymous role: every fixture helper saw
 * `null` or "permission denied for table profiles", and all 24 integration files failed in
 * `beforeAll`. Which key form PostgREST honours behind the local gateway is a property of the CLI
 * version, not of this repo, and it has already changed once.
 *
 * So instead of assuming, this script **probes**. For every candidate it can find — the stack's
 * own status output in both formats, and the example file — it asks PostgREST for a row from a
 * staff-only table. Only a key that reaches the database as `service_role` gets a row back; the
 * anonymous role gets an empty list or a permission error. The first candidate that passes is the
 * service key; the anon key is checked the same way against a public table. The outcome of every
 * probe is printed, so a future failure reads as a table rather than a mystery.
 *
 * Run with `pnpm exec tsx`, like the other scripts here; it needs nothing but Node's fetch.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/+$/, '');

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    const name = match?.[1];
    const value = match?.[2];
    if (name && value !== undefined) out[name] = value.trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const status = parseEnv(execSync('supabase status -o env', { encoding: 'utf8' }));
const example = parseEnv(readFileSync('.env.example', 'utf8'));
console.log('supabase status keys:', Object.keys(status).join(', '));

type Candidate = [label: string, key: string];
const present = (entry: [string, string | undefined]): entry is Candidate => Boolean(entry[1]);

const serviceCandidates: Candidate[] = (
  [
    ['status SECRET_KEY', status.SECRET_KEY],
    ['status SERVICE_ROLE_KEY', status.SERVICE_ROLE_KEY],
    ['example SUPABASE_SERVICE_ROLE_KEY', example.SUPABASE_SERVICE_ROLE_KEY],
  ] as [string, string | undefined][]
).filter(present);

const anonCandidates: Candidate[] = (
  [
    ['status PUBLISHABLE_KEY', status.PUBLISHABLE_KEY],
    ['status ANON_KEY', status.ANON_KEY],
    ['example NEXT_PUBLIC_SUPABASE_ANON_KEY', example.NEXT_PUBLIC_SUPABASE_ANON_KEY],
  ] as [string, string | undefined][]
).filter(present);

async function probe(key: string, path: string): Promise<{ status: number; body: string }> {
  try {
    const response = await fetch(`${url}${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const body = (await response.text()).replace(/\s+/g, ' ').slice(0, 100);
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: error instanceof Error ? error.message : String(error) };
  }
}

/** A key reaches the database as `service_role` only if a staff-only table answers with rows. */
async function pickService() {
  for (const [label, key] of serviceCandidates) {
    const result = await probe(key, '/rest/v1/warehouses?select=id&limit=1');
    const ok = result.status === 200 && result.body.startsWith('[{');
    console.log(`service probe · ${label}: ${result.status} ${result.body} → ${ok ? 'OK' : 'no'}`);
    if (ok) return key;
  }
  return null;
}

/** The anon key only has to be accepted by the gateway and reach a public table. */
async function pickAnon() {
  for (const [label, key] of anonCandidates) {
    const result = await probe(key, '/rest/v1/products?select=id&limit=1');
    const ok = result.status === 200 && result.body.startsWith('[');
    console.log(`anon probe · ${label}: ${result.status} ${result.body} → ${ok ? 'OK' : 'no'}`);
    if (ok) return key;
  }
  return null;
}

async function main(): Promise<void> {
  const service = await pickService();
  const anon = await pickAnon();

  if (!service || !anon) {
    console.error('No key pair reached PostgREST with the expected role. See the probes above.');
    process.exit(1);
  }

  let env = readFileSync('.env.local', 'utf8');
  env = env
    .replace(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*$/m, `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`)
    .replace(/^SUPABASE_SERVICE_ROLE_KEY=.*$/m, `SUPABASE_SERVICE_ROLE_KEY=${service}`);
  writeFileSync('.env.local', env);
  console.log(
    `.env.local now uses anon ${anon.slice(0, 12)}… and service ${service.slice(0, 10)}…`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
