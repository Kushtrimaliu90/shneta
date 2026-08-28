import { describe, expect, it } from 'vitest';
import { announcementParts } from '@/features/hero/announcement-parts';

/**
 * The four shapes of the announcement bar.
 *
 * The label used to be called `code` and rendered as a dead pill beside a **hardcoded** "Shop now"
 * link. The live row was the bug in one line: `cta_href = /merchant/apply`, `code = "BioPartner"`,
 * rendering "Bli tani". The author had already written the right words into a column nothing displayed.
 *
 * Extracted from the server component precisely so these five cases could be asserted without writing
 * to the `banners` row that is on screen in production.
 */
const title = { sq: 'Bëhu partner', en: 'Become a partner' };

describe('announcement bar composition', () => {
  it('label + link → a clickable pill, and the message stays plain', () => {
    const p = announcementParts({ title, linkLabel: 'BioPartner', href: '/merchant/apply' }, 'sq');
    expect(p).toEqual({
      message: 'Bëhu partner',
      label: 'BioPartner',
      href: '/merchant/apply',
      messageIsLink: false,
      pillIsLink: true,
    });
  });

  it('label, no link → the pill is plain text, with nothing to hover', () => {
    const p = announcementParts({ title, linkLabel: 'BioPartner', href: null }, 'sq');
    expect(p?.label).toBe('BioPartner');
    expect(p?.pillIsLink).toBe(false);
    expect(p?.messageIsLink).toBe(false);
  });

  it('link, no label → the message itself becomes the link', () => {
    const p = announcementParts({ title, linkLabel: null, href: '/merchant/apply' }, 'sq');
    expect(p?.label).toBeNull();
    expect(p?.messageIsLink).toBe(true);
    expect(p?.pillIsLink).toBe(false);
  });

  it('neither → the message alone, and no pill', () => {
    const p = announcementParts({ title, linkLabel: null, href: null }, 'sq');
    expect(p?.label).toBeNull();
    expect(p?.messageIsLink).toBe(false);
    expect(p?.pillIsLink).toBe(false);
  });

  it('never offers two anchors to one URL', () => {
    // With both fields filled the pill takes the link. A second anchor on the message would announce
    // the same destination twice to a screen reader and cost a keyboard user an extra tab stop.
    const p = announcementParts({ title, linkLabel: 'BioPartner', href: '/merchant/apply' }, 'sq');
    expect([p?.messageIsLink, p?.pillIsLink].filter(Boolean)).toHaveLength(1);
  });

  it('treats a whitespace-only label as absent, so no empty outline can render', () => {
    const p = announcementParts({ title, linkLabel: '   ', href: '/offers' }, 'sq');
    expect(p?.label).toBeNull();
    // And the link falls back to the message rather than vanishing with the pill.
    expect(p?.messageIsLink).toBe(true);
  });

  it('treats a whitespace-only link as absent', () => {
    const p = announcementParts({ title, linkLabel: 'BioPartner', href: '  ' }, 'sq');
    expect(p?.href).toBeNull();
    expect(p?.pillIsLink).toBe(false);
  });

  it('renders nothing at all without a message, however full the other fields are', () => {
    const empty = { sq: '', en: '' };
    expect(
      announcementParts({ title: empty, linkLabel: 'BioPartner', href: '/x' }, 'sq'),
    ).toBeNull();
  });

  it('follows the locale', () => {
    const p = announcementParts({ title, linkLabel: 'BioPartner', href: '/merchant/apply' }, 'en');
    expect(p?.message).toBe('Become a partner');
  });
});
