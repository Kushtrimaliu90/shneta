/**
 * docs/18 §3.5 — the image formats the proposal bucket takes, keyed by declared content type.
 *
 * Pure, and separate from `images.ts` (which is `server-only`), so the unit suite can pin the
 * mapping: the four formats here are the bucket's `allowed_mime_types`, and a fifth accepted here
 * would be refused by storage after the slot had already been minted.
 */

const EXTENSION_FOR: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** The extension we store under for a declared content type, or null when it is not an image we take. */
export function imageExtensionFor(contentType: string | null): string | null {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return EXTENSION_FOR[type] ?? null;
}
