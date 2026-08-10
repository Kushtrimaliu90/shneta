import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every merchant route has to be reachable by clicking.
 *
 * ── Why this exists ──
 *
 * `/merchant/proposals/bulk` shipped with no nav entry. It was reachable only from an underlined phrase
 * inside a paragraph on `/merchant/proposals`, and the photograph uploader sat one click further on,
 * behind a link labelled with a row count. Reported on 2026-08-10 as "only as a link, not as a clickable
 * item", together with "I could not find the bulk picture upload anywhere" — and the merchant it was
 * built for, one onboarding two hundred products, would meet the twenty-open-proposal cap on the single
 * form before ever finding it.
 *
 * This is the same failure the admin panel had, where `/admin/referrals` was invisible from the day it
 * shipped. That one is guarded by `ALL_NAV_ITEMS`; the merchant portal had no equivalent.
 *
 * ── What "reachable" means here ──
 *
 * Either the route is in the portal nav, or some file under `src/app/[locale]/merchant` or
 * `src/features/merchants` contains a link to it. That is deliberately loose: it cannot tell a button
 * from a word buried in a sentence, and it would have passed the bug that prompted it. What it does catch
 * is the case that actually keeps happening — a page added with **no** way in at all.
 *
 * Dynamic segments are matched by their static prefix, because a detail page is reached with an id
 * interpolated into the href.
 */
const APP = join(process.cwd(), 'src/app/[locale]/merchant');

function routes(dir: string, prefix = '/merchant'): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...routes(full, `${prefix}/${entry}`));
    } else if (entry === 'page.tsx') {
      found.push(prefix);
    }
  }
  return found;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry)) out.push(readFileSync(full, 'utf8'));
  }
  return out;
}

describe('the merchant portal has no unreachable pages', () => {
  const all = routes(APP);
  const nav = readFileSync(
    join(process.cwd(), 'src/features/merchants/components/merchant-nav.tsx'),
    'utf8',
  );
  const corpus = [
    ...sources(APP),
    ...sources(join(process.cwd(), 'src/features/merchants')),
  ].join('\n');

  it('found the routes it is supposed to be checking', () => {
    // A guard whose discovery silently returns nothing passes forever.
    expect(all.length).toBeGreaterThan(8);
    expect(all).toContain('/merchant/proposals/bulk');
  });

  it.each(all)('%s can be reached', (route) => {
    // `/merchant/offers/[id]` is linked as `/merchant/offers/${offer.id}`, so match the static prefix.
    const stat = route.replace(/\/\[[^\]]+\].*$/, '');
    const inNav = nav.includes(`'${route}'`) || nav.includes(`'${stat}'`);
    const linked =
      corpus.includes(`href="${route}"`) ||
      corpus.includes(`href={\`${stat}/`) ||
      corpus.includes(`href="${stat}"`) ||
      corpus.includes(`'${route}'`);

    expect(
      inNav || linked,
      `${route} has no nav entry and nothing links to it — a merchant would have to know the URL`,
    ).toBe(true);
  });

  it('puts both bulk screens in the nav, since neither is a detail page', () => {
    /*
     * Named explicitly rather than left to the loose check above. These two are the ones a merchant goes
     * looking for by name, and the reported bug was one of them being reachable only from prose.
     */
    expect(nav).toContain("'/merchant/bulk'");
    expect(nav).toContain("'/merchant/proposals/bulk'");
  });
});
