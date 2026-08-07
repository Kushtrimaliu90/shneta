import { describe, expect, it } from 'vitest';
import {
  matchSearchRedirect,
  normalizeQuery,
  type SearchRedirect,
} from '@/features/search/redirects';

/**
 * The redirect layer, which decides that a search wants a *page* rather than a product list.
 *
 * Worth unit-testing rather than leaving to E2E for two reasons: the precedence rules are easy to get
 * subtly wrong in a way that only shows up on one query in fifty, and `normalizeQuery` has to agree with
 * `public.search_normalize` — a divergence there means a rule an operator saved never fires and there is
 * no error anywhere to tell them why.
 */

const REDIRECTS: SearchRedirect[] = [
  { query: 'transport', matchType: 'contains', destinationPath: '/legal/shipping-returns' },
  { query: 'kontakt', matchType: 'contains', destinationPath: '/contact' },
  { query: 'porosia ime', matchType: 'contains', destinationPath: '/order-lookup' },
  { query: 'ime', matchType: 'contains', destinationPath: '/account' },
  { query: 'faq', matchType: 'exact', destinationPath: '/faq' },
  { query: 'pyetje', matchType: 'contains', destinationPath: '/faq' },
];

describe('normalizeQuery', () => {
  it('folds the Albanian diacritics', () => {
    // The whole reason this exists: phone keyboards here mostly omit ë and ç, so a rule saved with
    // them must still match a shopper who typed without.
    expect(normalizeQuery('Gjumë')).toBe('gjume');
    expect(normalizeQuery('Çrregullim')).toBe('crregullim');
    expect(normalizeQuery('Përbërës')).toBe('perberes');
  });

  it('lower-cases and collapses whitespace', () => {
    expect(normalizeQuery('  Vitamina    C  ')).toBe('vitamina c');
  });

  it('returns empty for whitespace only', () => {
    expect(normalizeQuery('   ')).toBe('');
  });
});

describe('matchSearchRedirect', () => {
  it('returns null when nothing matches', () => {
    expect(matchSearchRedirect(REDIRECTS, 'magnez', 'sq')).toBeNull();
  });

  it('returns null for an empty query rather than matching everything', () => {
    expect(matchSearchRedirect(REDIRECTS, '  ', 'sq')).toBeNull();
  });

  it('matches a substring', () => {
    expect(matchSearchRedirect(REDIRECTS, 'sa kushton transporti', 'sq')).toBe(
      '/legal/shipping-returns',
    );
  });

  it('prefers the longest contains match', () => {
    // Both 'porosia ime' and 'ime' are substrings. The specific one has to win, or every query
    // containing a common short word gets swallowed by the broadest rule in the table.
    expect(matchSearchRedirect(REDIRECTS, 'ku eshte porosia ime', 'sq')).toBe('/order-lookup');
  });

  it('prefers an exact match over a contains match', () => {
    const withBoth: SearchRedirect[] = [
      { query: 'kontakt', matchType: 'contains', destinationPath: '/contact' },
      { query: 'kontakt', matchType: 'exact', destinationPath: '/about' },
    ];
    expect(matchSearchRedirect(withBoth, 'kontakt', 'sq')).toBe('/about');
    // …but a longer query is not exact, so it falls through to contains.
    expect(matchSearchRedirect(withBoth, 'forma e kontaktit', 'sq')).toBe('/contact');
  });

  it('does not fire an exact rule on a longer query', () => {
    expect(matchSearchRedirect(REDIRECTS, 'faq per transportin', 'sq')).toBe(
      '/legal/shipping-returns',
    );
  });

  it('matches through diacritics and case', () => {
    expect(matchSearchRedirect(REDIRECTS, 'PYETJE të shpeshta', 'sq')).toBe('/faq');
  });

  it('localises the destination for English', () => {
    // Destinations are stored unlocalised so one row serves both locales; forgetting to prefix would
    // send an English shopper to the Albanian page.
    expect(matchSearchRedirect(REDIRECTS, 'kontakt', 'en')).toBe('/en/contact');
  });

  it('leaves the Albanian destination unprefixed', () => {
    expect(matchSearchRedirect(REDIRECTS, 'kontakt', 'sq')).toBe('/contact');
  });
});
