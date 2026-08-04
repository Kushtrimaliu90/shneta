import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envFromLocalFile } from '../integration/purge';

/**
 * `envFromLocalFile` has to agree with `@next/env` about what a `.env.local` line means.
 *
 * It exists because Vitest and Playwright load `.env.local` for the *app under test*, not into
 * their own process — so the scripts and guards that run outside Next need their own reader. Two
 * readers of one file is a fine arrangement right up until they disagree, and the disagreement is
 * invisible everywhere except the one value it corrupts.
 *
 * It corrupted `EMAIL_FROM`. The value must be quoted (it contains spaces and angle brackets),
 * dotenv unwraps the quotes and this did not, so `pnpm email:test` posted a `from` address with
 * literal `"` characters in it. The tool for proving email works was the one thing that could
 * not.
 */
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'biocode-env-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function parse(contents: string): Record<string, string> {
  const path = join(dir, '.env.test-fixture');
  writeFileSync(path, contents, 'utf8');
  return envFromLocalFile(path);
}

describe('envFromLocalFile', () => {
  it('unwraps double quotes, which EMAIL_FROM requires', () => {
    const env = parse('EMAIL_FROM="BIOCODE <porosite@biocode.fit>"\n');
    expect(env.EMAIL_FROM).toBe('BIOCODE <porosite@biocode.fit>');
  });

  it('unwraps single quotes too', () => {
    expect(parse("EMAIL_FROM='BIOCODE <a@b.com>'\n").EMAIL_FROM).toBe('BIOCODE <a@b.com>');
  });

  it('leaves an unquoted value alone', () => {
    expect(parse('RESEND_API_KEY=re_abc123\n').RESEND_API_KEY).toBe('re_abc123');
  });

  /** A lone quote is data, not a wrapper — stripping one side would corrupt the value. */
  it('does not strip a mismatched or single leading quote', () => {
    expect(parse('A="unclosed\n').A).toBe('"unclosed');
    expect(parse("B=it's\n").B).toBe("it's");
  });

  it('keeps quotes that are inside the value', () => {
    expect(parse('C=say "hi" now\n').C).toBe('say "hi" now');
  });

  it('ignores comments and blank lines', () => {
    const env = parse('# a comment\n\nD=1\n');
    expect(env.D).toBe('1');
    expect(Object.keys(env)).toEqual(['D']);
  });

  it('returns an empty object rather than throwing when the file is absent', () => {
    expect(envFromLocalFile(join(dir, 'does-not-exist'))).toEqual({});
  });
});
