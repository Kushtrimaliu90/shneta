import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownBody } from '@/features/content/components/markdown-body';

/**
 * docs/08 §3 — the article body sanitiser.
 *
 * This is a security boundary, not a formatting helper: article bodies come out of a database
 * that several staff roles can write to, and the alternative to sanitising is stored XSS on
 * every page of the Knowledge Center. It is unit-tested rather than left to an E2E assertion
 * because the interesting cases are the ones an editor would never type by hand.
 *
 * Rendered with `renderToStaticMarkup` so the assertions are about the HTML that reaches the
 * browser, which is what an attacker cares about.
 */
function render(markdown: string): string {
  return renderToStaticMarkup(MarkdownBody({ markdown }));
}

describe('MarkdownBody — what it keeps', () => {
  it('renders the tags docs/08 §3 allows', () => {
    const html = render(
      ['## Heading', '', '- one', '- two', '', '> quoted', '', '**bold** and *italic*'].join('\n'),
    );

    expect(html).toContain('<h2');
    expect(html).toContain('<ul');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
  });

  it('renders GFM tables, which plain markdown does not', () => {
    const html = render(['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n'));

    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
  });
});

describe('MarkdownBody — what it refuses', () => {
  it('strips a script tag', () => {
    const html = render('Before\n\n<script>alert(1)</script>\n\nAfter');

    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('Before');
  });

  it('strips an inline event handler', () => {
    const html = render('<img src="x" onerror="alert(1)" />');

    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('strips a javascript: URL', () => {
    // The classic bypass: valid markdown link syntax carrying a script URL.
    const html = render('[click me](javascript:alert(1))');

    expect(html).not.toContain('javascript:');
  });

  it('strips an iframe', () => {
    const html = render('<iframe src="https://evil.example"></iframe>');

    expect(html).not.toContain('<iframe');
  });

  /*
   * `h1` is not in the allowlist because the page already renders the article title as its
   * `<h1>`. Two is a document-outline error a screen reader announces and a crawler penalises,
   * and a body that opens with `#` is a normal thing for an editor to write.
   */
  it('demotes a body h1 to plain text rather than giving the page two', () => {
    const html = render('# Body heading\n\nText.');

    expect(html).not.toContain('<h1');
    expect(html).toContain('Body heading');
  });
});

describe('MarkdownBody — link handling (docs/08 §3)', () => {
  it('marks external links noopener nofollow and opens them in a new tab', () => {
    const html = render('[EFSA](https://www.efsa.europa.eu/)');

    expect(html).toContain('rel="noopener nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it('leaves internal links alone, so they pass link equity and stay in place', () => {
    const html = render('[our shop](/shop)');

    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain('nofollow');
  });
});

describe('MarkdownBody — nothing to render', () => {
  it('returns null for an empty body rather than an empty wrapper', () => {
    expect(MarkdownBody({ markdown: '   ' })).toBeNull();
  });
});
