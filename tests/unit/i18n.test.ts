import { describe, expect, it } from 'vitest';
import {
  asLocalizedField,
  isLocaleFallback,
  localizePath,
  pickLocale,
  pickLocaleFrom,
} from '@/lib/i18n';

describe('pickLocale', () => {
  const field = { sq: 'Vitamina D3', en: 'Vitamin D3' };

  it('returns the requested locale', () => {
    expect(pickLocale(field, 'sq')).toBe('Vitamina D3');
    expect(pickLocale(field, 'en')).toBe('Vitamin D3');
  });

  it('falls back to sq when the locale is missing or empty', () => {
    expect(pickLocale({ sq: 'Vetëm shqip' }, 'en')).toBe('Vetëm shqip');
    expect(pickLocale({ sq: 'Vetëm shqip', en: '' }, 'en')).toBe('Vetëm shqip');
  });

  it('never returns null — callers render the result directly', () => {
    expect(pickLocale(null, 'sq')).toBe('');
    expect(pickLocale(undefined, 'en')).toBe('');
    expect(pickLocale({}, 'en')).toBe('');
  });
});

describe('isLocaleFallback', () => {
  it('flags only the case where /en is showing Albanian', () => {
    expect(isLocaleFallback({ sq: 'Trupi' }, 'en')).toBe(true);
    expect(isLocaleFallback({ sq: 'Trupi', en: 'Body' }, 'en')).toBe(false);
    // sq is the reference locale, so it is never a fallback.
    expect(isLocaleFallback({ sq: 'Trupi' }, 'sq')).toBe(false);
    // Nothing to fall back to is a missing value, not a fallback.
    expect(isLocaleFallback({}, 'en')).toBe(false);
    expect(isLocaleFallback(null, 'en')).toBe(false);
  });
});

describe('asLocalizedField', () => {
  it('accepts a well-formed jsonb object', () => {
    expect(asLocalizedField({ sq: 'a', en: 'b' })).toEqual({ sq: 'a', en: 'b' });
  });

  it('drops unknown locales and non-string values', () => {
    expect(asLocalizedField({ sq: 'a', de: 'c', en: 42 })).toEqual({ sq: 'a' });
  });

  it('rejects non-objects rather than throwing', () => {
    expect(asLocalizedField(null)).toBeNull();
    expect(asLocalizedField('a string')).toBeNull();
    expect(asLocalizedField(['a'])).toBeNull();
  });

  it('composes with pickLocale for a direct jsonb read', () => {
    expect(pickLocaleFrom({ sq: 'Kolagjen', en: 'Collagen' }, 'en')).toBe('Collagen');
    expect(pickLocaleFrom('not jsonb', 'en')).toBe('');
  });
});

describe('localizePath', () => {
  it('leaves sq unprefixed and prefixes en', () => {
    expect(localizePath('/shop', 'sq')).toBe('/shop');
    expect(localizePath('/shop', 'en')).toBe('/en/shop');
    expect(localizePath('/', 'en')).toBe('/en');
    expect(localizePath('/', 'sq')).toBe('/');
  });

  it('is idempotent — switching back and forth cannot stack prefixes', () => {
    expect(localizePath('/en/shop', 'en')).toBe('/en/shop');
    expect(localizePath('/en/shop', 'sq')).toBe('/shop');
    expect(localizePath('/en', 'sq')).toBe('/');
    expect(localizePath(localizePath('/goals', 'en'), 'sq')).toBe('/goals');
  });

  it('does not mistake a path segment that merely starts with the locale', () => {
    expect(localizePath('/energji', 'en')).toBe('/en/energji');
    expect(localizePath('/en-route', 'sq')).toBe('/en-route');
  });
});
