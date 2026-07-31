import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * docs/13 §C — the palette is asserted, not assumed.
 *
 * CLAUDE.md §12 and docs/01 §4 make WCAG 2.1 AA a hard floor, and three tokens in the
 * original pack missed it. This suite reads the real token values out of `globals.css` and
 * fails the build if any text or control colour regresses below its threshold, so nobody
 * can "fix" a design nit by darkening a swatch back into a violation.
 */

const CSS = readFileSync(join(process.cwd(), 'src', 'styles', 'globals.css'), 'utf8');

function token(name: string): string {
  const match = CSS.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match?.[1]) throw new Error(`Token --color-${name} not found in globals.css`);
  return match[1];
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function ratio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const AA_TEXT = 4.5;
const AA_LARGE_AND_UI = 3;

describe('contrast helper', () => {
  it('agrees with the reference values for black and white', () => {
    expect(ratio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(ratio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('body and heading text on the page background', () => {
  const cream = token('cream');

  it.each([
    ['ink-900', 'body text'],
    ['ink-600', 'secondary text'],
    ['ink-500', 'eyebrows, meta and helper text'],
    ['forest-900', 'headings'],
    ['forest-800', 'primary links'],
    ['forest-700', 'links'],
  ])('%s passes AA for %s', (name) => {
    expect(ratio(token(name), cream)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('ink-400 is below AA and is therefore decorative-only (docs/13 §C)', () => {
    // Documents the constraint rather than the aspiration: if someone raises ink-400 to a
    // text-safe value this fails, prompting them to update the guidance instead of silently
    // widening where it may be used.
    expect(ratio(token('ink-400'), cream)).toBeLessThan(AA_TEXT);
  });
});

describe('text on filled surfaces', () => {
  it('white on the primary button passes AA', () => {
    expect(ratio('#ffffff', token('forest-800'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('white on the hover fill still passes AA', () => {
    expect(ratio('#ffffff', token('forest-700'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('lime fills use lime-950 text, never white (docs/04 §3)', () => {
    expect(ratio(token('lime-950'), token('lime-500'))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio('#ffffff', token('lime-500'))).toBeLessThan(AA_TEXT);
  });

  it('cream text on the footer ground passes AA', () => {
    expect(ratio(token('cream'), token('forest-950'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('semantic colours pass AA as text on the page background', () => {
    for (const name of ['success', 'warning', 'error', 'info']) {
      expect(ratio(token(name), token('cream'))).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe('non-text contrast — WCAG SC 1.4.11', () => {
  const cream = token('cream');

  it('the focus indicator is visible against the page (docs/13 §C)', () => {
    expect(ratio(token('focus'), cream)).toBeGreaterThanOrEqual(AA_LARGE_AND_UI);
  });

  it('a lone lime ring would NOT have been visible — this is why focus is two-tone', () => {
    expect(ratio(token('lime-500'), cream)).toBeLessThan(AA_LARGE_AND_UI);
  });

  it('control borders use line-strong, which passes', () => {
    expect(ratio(token('line-strong'), cream)).toBeGreaterThanOrEqual(AA_LARGE_AND_UI);
  });

  it('the decorative divider is documented as failing and must not bound a control', () => {
    expect(ratio(token('line'), cream)).toBeLessThan(AA_LARGE_AND_UI);
  });

  it('goal-tile icons pass the graphics threshold on their tint', () => {
    expect(ratio(token('forest-500'), token('forest-50'))).toBeGreaterThanOrEqual(AA_LARGE_AND_UI);
  });
});
