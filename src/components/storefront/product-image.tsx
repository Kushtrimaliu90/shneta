import Image from 'next/image';
import { clientEnv } from '@/lib/env.client';
import { cn } from '@/lib/utils';

/**
 * A product image, or a branded fallback tile when there is none.
 *
 * A newly created product exists before its photography does, so the fallback is a real state in
 * production and not only a seed artefact — a broken `next/image` 404 would be worse than an
 * obviously-intentional placeholder (docs/04 §9).
 *
 * ── Why both branches render the same wrapper ──
 *
 * They did not, and that was a latent layout bug for eleven milestones. The fallback was a `<div>` sized
 * by `className`; the photograph was a bare `<Image fill>`, which is `position: absolute; inset: 0` and
 * therefore ignores `size-*` for positioning entirely — it fills the nearest **positioned ancestor**.
 *
 * Call sites that wrapped it in a `relative` box were fine. The ones that passed `size-12 p-1` and
 * expected an in-flow box got an image stretched across whatever container happened to be positioned
 * further up the tree. Nothing showed it while the catalogue had no photographs, because every product
 * rendered the in-flow fallback. The day real images landed, an `<img sizes="48px">` on the subscriptions
 * page covered its entire `<ul>` and swallowed the clicks on the Pause button; the compare table's remove
 * button went the same way. Both were reported by Playwright as the image "intercepting pointer events",
 * which is the clearest description of the bug anybody wrote.
 *
 * So the wrapper is always rendered and always `relative`. `className` sizes *it*, which is what every
 * call site already meant, and `inset: 0` resolves against its padding box — so `p-2` still insets the
 * photograph exactly as before.
 */
export function ProductImage({
  path,
  alt,
  sizes,
  priority = false,
  fit = 'contain',
  className,
}: {
  path: string | null;
  alt: string;
  sizes: string;
  priority?: boolean;
  /**
   * `contain` for a packshot on a tile — the whole bottle, letterboxed. `cover` where the image is
   * decorative and the box has to be filled.
   *
   * A prop rather than an `object-*` class in `className`, because `className` now lands on the wrapper
   * where an `object-*` utility would be silently inert.
   */
  fit?: 'contain' | 'cover';
  className?: string;
}) {
  return (
    <div className={cn('relative overflow-hidden', className)}>
      {path ? (
        <Image
          src={`${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${path}`}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={fit === 'cover' ? 'object-cover' : 'object-contain'}
        />
      ) : (
        <div
          className="flex size-full items-center justify-center bg-forest-50"
          // Decorative: the product name is always adjacent in the card and on the PDP.
          aria-hidden="true"
        >
          <svg viewBox="0 0 48 48" className="size-1/3 opacity-40" aria-hidden="true">
            <circle
              cx="24"
              cy="24"
              r="18"
              fill="none"
              stroke="var(--color-forest-500)"
              strokeWidth="2.5"
              strokeDasharray="113"
              strokeDashoffset="34"
              transform="rotate(-90 24 24)"
            />
            <circle cx="24" cy="24" r="7" fill="var(--color-forest-500)" />
          </svg>
        </div>
      )}
    </div>
  );
}
