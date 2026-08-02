import Image from 'next/image';
import { clientEnv } from '@/lib/env.client';
import { cn } from '@/lib/utils';

/**
 * A product image, or a branded fallback tile when there is none.
 *
 * The seeded catalogue has no images (see supabase/seeds/02), so the fallback is the normal
 * case today, not an edge case — and it stays useful in production, where a newly created
 * product exists before its photography does. A broken `next/image` 404 would be worse than
 * an obviously-intentional placeholder (docs/04 §9).
 */
export function ProductImage({
  path,
  alt,
  sizes,
  priority = false,
  className,
}: {
  path: string | null;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  if (!path) {
    return (
      <div
        className={cn('flex items-center justify-center bg-forest-50', className)}
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
    );
  }

  return (
    <Image
      src={`${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${path}`}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={cn('object-contain', className)}
    />
  );
}
