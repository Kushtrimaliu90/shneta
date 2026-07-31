import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  clientIpFrom,
  isPresent,
  readingMinutes,
  safeJsonParse,
  slugify,
  truncate,
} from '@/lib/utils';
import { fail, fromFieldErrors, isOk, ok } from '@/lib/result';

describe('slugify', () => {
  it('folds Albanian diacritics to ASCII', () => {
    expect(slugify('Shëndeti i Gruas')).toBe('shendeti-i-gruas');
    expect(slugify('Përbërësit')).toBe('perberesit');
    expect(slugify('Adaptogjenët')).toBe('adaptogjenet');
    expect(slugify('Çaji jeshil')).toBe('caji-jeshil');
  });

  it('produces clean, collapsed, trimmed slugs', () => {
    expect(slugify('  NOW Vitamin D3 4000 IU  ')).toBe('now-vitamin-d3-4000-iu');
    expect(slugify('Omega 3-6-9')).toBe('omega-3-6-9');
    expect(slugify('a // b')).toBe('a-b');
    expect(slugify('!!!')).toBe('');
  });

  it('caps length so slugs stay URL-friendly', () => {
    expect(slugify('a'.repeat(200))).toHaveLength(96);
  });
});

describe('readingMinutes', () => {
  it('is words / 200, rounded up', () => {
    expect(readingMinutes(Array(200).fill('fjalë').join(' '))).toBe(1);
    expect(readingMinutes(Array(201).fill('fjalë').join(' '))).toBe(2);
    expect(readingMinutes(Array(600).fill('fjalë').join(' '))).toBe(3);
  });

  it('never returns zero, even for an empty body', () => {
    expect(readingMinutes('')).toBe(1);
    expect(readingMinutes('   ')).toBe(1);
  });

  it('does not count code fences as prose', () => {
    const body = `${Array(100).fill('fjalë').join(' ')}\n\n\`\`\`\n${Array(500).fill('x').join(' ')}\n\`\`\``;
    expect(readingMinutes(body)).toBe(1);
  });
});

describe('truncate', () => {
  it('leaves short strings alone', () => {
    expect(truncate('short', 20)).toBe('short');
  });

  it('cuts on a word boundary and appends an ellipsis', () => {
    expect(truncate('the quick brown fox jumps', 16)).toBe('the quick brown…');
  });

  it('hard-cuts when there is no usable boundary', () => {
    expect(truncate('aaaaaaaaaaaaaaaaaaaa', 5)).toBe('aaaaa…');
  });
});

describe('absoluteUrl', () => {
  it('builds canonical-safe absolute URLs', () => {
    expect(absoluteUrl('/shop', 'https://shneta.com')).toBe('https://shneta.com/shop');
    expect(absoluteUrl('shop', 'https://shneta.com')).toBe('https://shneta.com/shop');
  });
});

describe('clientIpFrom', () => {
  it('takes the left-most forwarded address', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.5, 70.41.3.18' });
    expect(clientIpFrom(headers)).toBe('203.0.113.5');
  });

  it('falls back through x-real-ip to a constant bucket', () => {
    expect(clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
    expect(clientIpFrom(new Headers())).toBe('unknown');
  });
});

describe('misc guards', () => {
  it('isPresent narrows out null and undefined', () => {
    expect([1, null, 2, undefined].filter(isPresent)).toEqual([1, 2]);
  });

  it('safeJsonParse never throws', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse('not json')).toBeNull();
    expect(safeJsonParse(null)).toBeNull();
  });
});

describe('ActionResult (docs/02 §7)', () => {
  it('wraps success with and without data', () => {
    expect(ok()).toEqual({ ok: true, data: undefined });
    expect(ok({ id: '1' })).toEqual({ ok: true, data: { id: '1' } });
    expect(isOk(ok(1))).toBe(true);
  });

  it('wraps failure, omitting fieldErrors when there are none', () => {
    expect(fail('CART_EMPTY')).toEqual({ ok: false, error: 'CART_EMPTY' });
    expect(isOk(fail('CART_EMPTY'))).toBe(false);
  });

  it('flattens Zod field errors and drops empty entries', () => {
    const result = fromFieldErrors('VALIDATION', {
      fieldErrors: { email: ['Invalid email'], phone: [], name: undefined },
    });
    expect(result).toEqual({
      ok: false,
      error: 'VALIDATION',
      fieldErrors: { email: ['Invalid email'] },
    });
  });
});
