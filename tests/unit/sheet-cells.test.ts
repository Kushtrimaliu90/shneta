import { describe, expect, it } from 'vitest';
import {
  readBoolean,
  readFormCell,
  readList,
  readMoneyCell,
  readSlugCell,
  readStatusCell,
  readTagsCell,
} from '@/features/catalog/sheet-cells';

/**
 * The rules an operator collides with when they upload an edited catalogue.
 *
 * Every case here is a mistake somebody will actually make in Excel — a comma decimal, a status they are not
 * allowed to set from a file, an invented tag — plus the one that matters most: the untouched cell that must
 * read as "nothing changed". Each assertion also pins the sentence shown, because a refusal an operator
 * cannot act on is only marginally better than a silent failure.
 */

describe('readMoneyCell', () => {
  it('treats a trailing zero the export wrote and Excel dropped as no change', () => {
    // The export writes 10.90; Excel stores the number 10.9; the reader gives back "10.9".
    expect(readMoneyCell('10.9', '10.90', { required: true })).toEqual({ kind: 'same' });
    expect(readMoneyCell('10', '10.00', { required: true })).toEqual({ kind: 'same' });
  });

  it('accepts a comma decimal, which is how a Kosovo keyboard types a price', () => {
    expect(readMoneyCell('12,50', '10.00', { required: true })).toEqual({ kind: 'set', cents: 1250 });
  });

  it('accepts a dot decimal too', () => {
    expect(readMoneyCell('12.50', '10.00', { required: true })).toEqual({ kind: 'set', cents: 1250 });
  });

  it('refuses a thousands separator instead of guessing which mark is the decimal', () => {
    const verdict = readMoneyCell('1.234,50', '10.00', { required: true });
    expect(verdict.kind).toBe('refuse');
    // The historical bug this guards: a locale decimal read as a thousands mark, priced 100x too high.
    expect(verdict.kind === 'refuse' && verdict.problem).toContain('no thousands separator');
  });

  it('refuses three decimal places', () => {
    expect(readMoneyCell('9.999', '10.00', { required: true }).kind).toBe('refuse');
  });

  it('refuses text in a price cell and quotes what was typed', () => {
    const verdict = readMoneyCell('ten euro', '10.00', { required: true });
    expect(verdict.kind === 'refuse' && verdict.problem).toContain('"ten euro"');
  });

  it('refuses zero and negative prices', () => {
    expect(readMoneyCell('0', '10.00', { required: true }).kind).toBe('refuse');
    expect(readMoneyCell('-5', '10.00', { required: true }).kind).toBe('refuse');
  });

  it('refuses an emptied price but clears an emptied compare-at price', () => {
    expect(readMoneyCell('', '10.00', { required: true })).toEqual({
      kind: 'refuse',
      problem: 'A variant needs a price.',
    });
    expect(readMoneyCell('', '14.00', { required: false })).toEqual({ kind: 'clear' });
  });

  it('leaves an already-empty optional amount alone rather than clearing it again', () => {
    expect(readMoneyCell('', '', { required: false })).toEqual({ kind: 'same' });
  });
});

describe('readStatusCell', () => {
  it('refuses to publish from a file, and says who has to approve', () => {
    const verdict = readStatusCell('published', 'draft');
    expect(verdict.kind).toBe('refuse');
    expect(verdict.kind === 'refuse' && verdict.problem).toContain('compliance');
  });

  it('leaves an already-published product alone when the cell was not touched', () => {
    // Otherwise every published row in an untouched download would be refused.
    expect(readStatusCell('published', 'published')).toEqual({ kind: 'same' });
  });

  it('allows the three statuses a file may set', () => {
    expect(readStatusCell('archived', 'draft')).toEqual({ kind: 'set', value: 'archived' });
    expect(readStatusCell('pending_review', 'draft')).toEqual({ kind: 'set', value: 'pending_review' });
    expect(readStatusCell('DRAFT', 'archived')).toEqual({ kind: 'set', value: 'draft' });
  });

  it('refuses a status nobody defined', () => {
    expect(readStatusCell('live', 'draft').kind).toBe('refuse');
  });
});

describe('readSlugCell', () => {
  it('locks the web address of a published product', () => {
    const verdict = readSlugCell('new-address', 'old-address', { published: true });
    expect(verdict.kind === 'refuse' && verdict.problem).toContain('locked');
  });

  it('allows a draft to be renamed', () => {
    expect(readSlugCell('new-address', 'old-address', { published: false })).toEqual({
      kind: 'set',
      value: 'new-address',
    });
  });

  it('refuses a slug Excel would happily accept but a URL would not', () => {
    for (const bad of ['Not A Slug', 'trailing-', 'double--hyphen', 'ünïcode', '']) {
      expect(readSlugCell(bad, 'old-address', { published: false }).kind).toBe('refuse');
    }
  });

  it('is unbothered by a published product whose slug was not touched', () => {
    expect(readSlugCell('old-address', 'old-address', { published: true })).toEqual({ kind: 'same' });
  });
});

describe('readFormCell', () => {
  it('accepts a known form, case-insensitively', () => {
    expect(readFormCell('Capsule', 'tablet')).toEqual({ kind: 'set', value: 'capsule' });
  });

  it('treats an emptied form as unset rather than refusing it', () => {
    expect(readFormCell('', 'capsule')).toEqual({ kind: 'set', value: null });
  });

  it('refuses an invented form and lists the real ones', () => {
    const verdict = readFormCell('pill', 'capsule');
    expect(verdict.kind === 'refuse' && verdict.problem).toContain('capsule');
  });
});

describe('readTagsCell', () => {
  it('reads a comma list and lowercases it', () => {
    expect(readTagsCell('Vegan, gluten_free', '')).toEqual({
      kind: 'set',
      value: ['vegan', 'gluten_free'],
    });
  });

  it('is order-sensitive but not whitespace-sensitive when comparing', () => {
    expect(readTagsCell(' vegan ,  gluten_free ', 'vegan, gluten_free')).toEqual({ kind: 'same' });
  });

  it('refuses a tag that is not in the vocabulary', () => {
    const verdict = readTagsCell('vegan, organic-ish', '');
    expect(verdict.kind === 'refuse' && verdict.problem).toContain('organic-ish');
  });

  it('clears the tags when the cell is emptied', () => {
    expect(readTagsCell('', 'vegan')).toEqual({ kind: 'set', value: [] });
  });
});

describe('readBoolean', () => {
  it('accepts what people type, in both languages', () => {
    for (const yes of ['yes', 'Y', 'TRUE', '1', 'po', ' yes ']) expect(readBoolean(yes)).toBe(true);
    for (const no of ['no', 'N', 'false', '0', 'jo']) expect(readBoolean(no)).toBe(false);
  });

  it('refuses to guess at anything else, including an empty cell', () => {
    for (const unclear of ['', 'maybe', '2', 'x']) expect(readBoolean(unclear)).toBeNull();
  });
});

describe('readList', () => {
  it('trims, drops blanks, and de-duplicates while keeping order', () => {
    expect(readList(' b , a ,, b , ')).toEqual(['b', 'a']);
  });

  it('reads an empty cell as an empty list, not as one empty entry', () => {
    expect(readList('')).toEqual([]);
    expect(readList('  ,  ')).toEqual([]);
  });
});
