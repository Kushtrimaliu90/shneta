import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fieldErrorsFrom, hasErrorUnder, FORM_LEVEL } from '@/lib/field-errors';
import {
  CATALOG_FIELD_MESSAGES,
  productGeneralSchema,
  productSeoSchema,
  variantSchema,
} from '@/features/catalog/admin-schemas';

/**
 * Guards for the per-field error reporting.
 *
 * The defect these exist for: `saveProductGeneral` computed its field errors, wrote them to the log and
 * returned only `'admin.catalog.errors.checkFields'` — whose text is "Check the fields marked below",
 * with nothing marked below. Nothing in the suite noticed, because nothing asserted that a rejected save
 * says *which* field.
 */

const UUID = '00000000-0000-4000-8000-000000000000';

/** A General-tab submission with a real problem in each interesting shape. */
function badGeneral() {
  return productGeneralSchema.safeParse({
    productId: UUID,
    slug: 'Not A Slug',
    brandId: '', // an untouched <select>
    name: { sq: '', en: 'x'.repeat(200) },
    subtitle: { sq: '', en: '' },
    description: { sq: '', en: '' },
    howToUse: { sq: '', en: '' },
    warnings: { sq: '', en: '' },
    dietaryTags: [],
    categoryIds: [],
    goalIds: [],
  });
}

describe('fieldErrorsFrom', () => {
  it('keys a bilingual field by its full path, which flatten() cannot', () => {
    const parsed = badGeneral();
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const errors = fieldErrorsFrom(parsed.error.issues, CATALOG_FIELD_MESSAGES);

    /*
     * The whole point. `flatten().fieldErrors` returns one `name` key holding both messages, so neither
     * of the two inputs can be marked — asserted here so a well-meaning revert to `flatten()` fails.
     */
    expect(Object.keys(parsed.error.flatten().fieldErrors)).toContain('name');
    expect(Object.keys(parsed.error.flatten().fieldErrors)).not.toContain('name.sq');

    expect(errors['name.sq']).toBeDefined();
    expect(errors['name.en']).toBeDefined();
  });

  it('translates this project machine codes into sentences', () => {
    const parsed = badGeneral();
    if (parsed.success) throw new Error('expected failure');
    const errors = fieldErrorsFrom(parsed.error.issues, CATALOG_FIELD_MESSAGES);

    // 'REQUIRED' and 'SLUG_INVALID' are Zod *messages* in this codebase — they must never reach a screen.
    const everyMessage = Object.values(errors).flat().join(' | ');
    expect(everyMessage).not.toMatch(/REQUIRED|SLUG_INVALID|SLUG_TOO_SHORT|SKU_INVALID/);

    expect(errors['name.sq']).toEqual(['Required.']);
    expect(errors.slug?.[0]).toContain('Lowercase letters');
    // An empty <select> fails a uuid rule; "Invalid UUID" is not an instruction.
    expect(errors.brandId).toEqual(['Choose one from the list.']);
  });

  it('says how long is too long, rather than just too long', () => {
    const parsed = badGeneral();
    if (parsed.success) throw new Error('expected failure');
    const errors = fieldErrorsFrom(parsed.error.issues, CATALOG_FIELD_MESSAGES);
    expect(errors['name.en']).toEqual(['Too long — 160 characters at most.']);
  });

  it('keeps every problem on a field, not just the first', () => {
    // `slug` is min(3) AND a regex, so a short bad slug trips both.
    const parsed = productGeneralSchema.safeParse({
      productId: UUID,
      slug: 'A',
      brandId: UUID,
      name: { sq: 'ok', en: '' },
      subtitle: { sq: '', en: '' },
      description: { sq: '', en: '' },
      howToUse: { sq: '', en: '' },
      warnings: { sq: '', en: '' },
      dietaryTags: [],
      categoryIds: [],
      goalIds: [],
    });
    if (parsed.success) throw new Error('expected failure');
    const errors = fieldErrorsFrom(parsed.error.issues, CATALOG_FIELD_MESSAGES);
    expect(errors.slug?.length).toBe(2);
  });

  it('translates the SEO length ceiling, which used to arrive as Zod prose', () => {
    const parsed = productSeoSchema.safeParse({ productId: UUID, titleSq: 'x'.repeat(90) });
    if (parsed.success) throw new Error('expected failure');
    const errors = fieldErrorsFrom(parsed.error.issues, CATALOG_FIELD_MESSAGES);
    expect(errors.titleSq).toEqual(['Too long — 70 characters at most.']);
    expect(errors.titleSq?.[0]).not.toContain('expected string');
  });

  it('files a problem with no path under _form so it cannot vanish', () => {
    // An object-level issue has an empty path and belongs to no input.
    const errors = fieldErrorsFrom([{ path: [], code: 'custom', message: 'Two things clash.' }]);
    expect(errors[FORM_LEVEL]).toEqual(['Two things clash.']);
  });

  it('keeps a hand-written refine message, but refuses a bare machine code', () => {
    // `.refine()` prose is the most specific text available and must survive.
    expect(fieldErrorsFrom([{ path: ['a'], code: 'custom', message: 'Ends before it starts.' }]).a)
      .toEqual(['Ends before it starts.']);

    // A SCREAMING_SNAKE message on an unhandled code is a constant name, not a sentence.
    expect(fieldErrorsFrom([{ path: ['a'], code: 'custom', message: 'DATE_ORDER' }]).a)
      .toEqual(['Not valid.']);
  });

  it('survives a symbol path segment instead of throwing', () => {
    /*
     * `[Symbol()].join('.')` throws outright, and a throw while *reporting* a validation error would
     * replace a fixable form with a crash.
     */
    expect(() =>
      fieldErrorsFrom([{ path: [Symbol('x')], code: 'custom', message: 'odd' }]),
    ).not.toThrow();
  });
});

describe('hasErrorUnder', () => {
  it('matches a field and its children but not a lookalike prefix', () => {
    const errors = { 'name.sq': ['Required.'], nameOfThing: ['Required.'] };
    expect(hasErrorUnder(errors, 'name')).toBe(true);
    expect(hasErrorUnder({ nameOfThing: ['x'] }, 'name')).toBe(false);
  });
});

/**
 * The static half: a message is only useful if it lands on an input.
 *
 * Nothing in the type system connects `'name.sq'` coming out of the schema to `name="name.sq"` in the
 * editor, so a renamed input would silently stop being marked while every test above still passed. This
 * reads the component source and checks the join by hand — the same tactic as `admin-nav.test.ts`.
 */
describe('every reported path reaches a real input', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/features/catalog/components/product-editor.tsx'),
    'utf8',
  );

  /** `name="x"`, plus the template form the bilingual pair uses: `name={`${name}.sq`}`. */
  function rendersField(path: string): boolean {
    if (source.includes(`name="${path}"`)) return true;
    // A bilingual half is emitted as a template literal, so match the suffix instead.
    const [, half] = path.split('.');
    return half !== undefined && source.includes('name={`${name}.' + half + '`}');
  }

  it('covers the General tab', () => {
    const parsed = badGeneral();
    if (parsed.success) throw new Error('expected failure');
    const paths = Object.keys(fieldErrorsFrom(parsed.error.issues, CATALOG_FIELD_MESSAGES));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((path) => !rendersField(path))).toEqual([]);
  });

  it('covers the variant form, including both prices', () => {
    const parsed = variantSchema.safeParse({
      productId: UUID,
      sku: 'lower case',
      name: { sq: '', en: '' },
      price: '',
    });
    if (parsed.success) throw new Error('expected failure');
    const paths = Object.keys(fieldErrorsFrom(parsed.error.issues, CATALOG_FIELD_MESSAGES));
    expect(paths.filter((path) => !rendersField(path))).toEqual([]);

    // The two prices are validated outside Zod, so assert their inputs exist by name.
    expect(rendersField('price')).toBe(true);
    expect(rendersField('compareAtPrice')).toBe(true);
  });

  it('covers the SEO tab', () => {
    const parsed = productSeoSchema.safeParse({
      productId: UUID,
      titleSq: 'x'.repeat(90),
      descriptionEn: 'y'.repeat(300),
    });
    if (parsed.success) throw new Error('expected failure');
    const paths = Object.keys(fieldErrorsFrom(parsed.error.issues, CATALOG_FIELD_MESSAGES));
    expect(paths.filter((path) => !rendersField(path))).toEqual([]);
  });
});
