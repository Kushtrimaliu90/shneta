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

  /**
   * forest-50 is the tint on every selected card and filled panel — the checkout delivery
   * and payment options, the COD callout on the success page, the ingredient table head.
   *
   * It is very slightly darker than cream, and that is enough to matter: ink-500 clears AA
   * on cream at 4.53:1 and misses it on forest-50 at 4.43:1. axe caught it on the payment
   * radio card, which is not a place to be sloppy about legibility. These two assertions
   * encode the resulting rule — **secondary text on a tint is ink-600, never ink-500** —
   * so it is a test failure rather than something to rediscover with a browser.
   */
  it('ink-500 does NOT pass on the forest-50 tint, which is why tints use ink-600', () => {
    expect(ratio(token('ink-500'), token('forest-50'))).toBeLessThan(AA_TEXT);
  });

  it('ink-600 passes comfortably on the forest-50 tint', () => {
    expect(ratio(token('ink-600'), token('forest-50'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  /**
   * `forest-100` is the **active filter tab** fill, and it is darker than `forest-50` — so a
   * colour that passes on one tint can still fail on the other (docs/13 §Q4).
   *
   * Seven admin lists and the public Knowledge page all put a count in `ink-500` inside a tab
   * that turns `forest-100` when selected: 4.00:1 against a 4.5 floor. It shipped in M5 and
   * survived to M11, because the only page axe covered was the dashboard, which has no tabs.
   * Widening the axe pass is what found it; this is what stops it coming back.
   */
  it('ink-500 does NOT pass on the forest-100 tint either', () => {
    expect(ratio(token('ink-500'), token('forest-100'))).toBeLessThan(AA_TEXT);
  });

  it('ink-600 passes on the forest-100 tint, which is why active tabs use it', () => {
    expect(ratio(token('ink-600'), token('forest-100'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  /**
   * The article-card cover placeholder, and the general rule it cost us (docs/13 §N7).
   *
   * The first version used `text-forest-800/40` on the same tint — a token at 40% alpha, which
   * *looks* like a style choice and is a contrast decision. It resolves to #9bb0a7 on #f0f7f3:
   * **2.1:1**, less than half the floor, and axe found 233 instances of it on one page.
   *
   * The rule this encodes: **an alpha on a text colour is not a design nit, it is a new colour**
   * — so placeholders use a solid token, and this asserts the one that replaced it.
   */
  it('forest-600 passes on the forest-50 tint, which is why placeholders use it', () => {
    expect(ratio(token('forest-600'), token('forest-50'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('forest-500 does NOT pass on the forest-50 tint, so it is not the fallback', () => {
    expect(ratio(token('forest-500'), token('forest-50'))).toBeLessThan(AA_TEXT);
  });

  /**
   * The admin environment badge — the only thing distinguishing a preview panel from the
   * production one, so it must be legible before it is pretty.
   *
   * It shipped as `bg-warning/15` + `text-warning`, which axe measured at 4.08:1: a 15% tint
   * over cream resolves to #f4e5da, and the amber on that misses AA. The lesson generalises
   * past this one badge — **a `/15` tint of a semantic colour is not a safe background for
   * that same colour as text.** Solid fill with white is the pattern to reach for.
   */
  it('white on a solid warning fill passes AA, which the tinted version did not', () => {
    expect(ratio('#ffffff', token('warning'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  /**
   * The admin status badges (`features/admin/components/status-badge.tsx`).
   *
   * Seven order states and five payment states need to be distinguishable at a glance in a long
   * table. The first attempt reached for arbitrary hex to get enough hues, which CLAUDE.md §9
   * forbids; solid semantic fills with white text give the same separation from the existing
   * palette. This asserts the whole set at once, so adding a badge tone that fails is a test
   * failure rather than something axe finds later on one page that happened to be sampled.
   */
  it.each(['warning', 'success', 'error', 'info', 'forest-800', 'ink-600'])(
    'white text on a solid %s fill passes AA',
    (name) => {
      expect(ratio('#ffffff', token(name))).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it('the pale forest badge uses forest-900 text and passes', () => {
    expect(ratio(token('forest-900'), token('forest-100'))).toBeGreaterThanOrEqual(AA_TEXT);
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
