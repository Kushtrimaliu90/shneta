'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { pickLocale, type LocalizedField } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { ProductImage } from '@/components/storefront/product-image';
import { cn } from '@/lib/utils';

/**
 * docs/05 §3 — the PDP gallery: main image plus a thumbnail rail.
 *
 * This exists because the page was rendering `images[0]` and discarding the rest of the
 * position-sorted array the query already returns — and for a supplement the second image is
 * usually the label, which is the one photograph a careful buyer actually studies. Rendering
 * only the packshot threw away the most persuasive asset in the bucket.
 *
 * The rail is buttons, not a carousel: two to four images do not need swipe machinery, and a
 * button with a real accessible name ("Image 2 of 3") and `aria-pressed` is keyboard-complete
 * for free. The selected thumb borrows the variant chip's selected language
 * (`border-forest-800 bg-forest-100`), so "chosen" looks the same everywhere on this page.
 *
 * Only mounted when there is something to choose between — the page keeps its original
 * server-rendered tile for single-image products, so this client boundary costs nothing there.
 */
export function ProductGallery({
  images,
  productName,
}: {
  images: { path: string; alt: LocalizedField }[];
  productName: string;
}) {
  const t = useTranslations('product');
  const locale = useLocale() as Locale;
  const [index, setIndex] = useState(0);
  const current = images[index] ?? images[0];

  return (
    <div>
      {/*
        The card's endorsed wash rather than flat cream: packshots are cut out on white, so a
        single flat tint behind them reads as two rectangles — the measurement lives in
        product-card.tsx. The rounded-xl + border-line frame is unchanged from the single-image
        tile so the two rendering paths sit identically in the layout.
      */}
      <div className="relative aspect-square overflow-hidden rounded-xl border border-line bg-gradient-to-b from-white to-cream">
        <ProductImage
          path={current?.path ?? null}
          alt={pickLocale(current?.alt, locale) || productName}
          /* Preload only the image that is in the server HTML; the rest load on selection. */
          priority={index === 0}
          /*
            The gallery sits in `container-page`, which caps at 1240 — so half of it is about 596px
            and never more, whatever the monitor. `50vw` asked for 960 at 1920 and fetched a 1080px
            variant for a 562px box.
          */
          sizes="(min-width: 1024px) 620px, 100vw"
          className="absolute inset-0 size-full p-8"
        />
      </div>

      {/*
        `overflow-x-auto` so a long rail scrolls on a phone instead of wrapping under the fold;
        the padding keeps the 6px focus ring from being clipped by that scroll container.
      */}
      <ul className="-mx-1.5 mt-2 flex gap-2 overflow-x-auto p-1.5">
        {images.map((image, thumbIndex) => {
          const active = thumbIndex === index;

          return (
            <li key={image.path} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(thumbIndex)}
                aria-pressed={active}
                aria-label={t('galleryImageLabel', { n: thumbIndex + 1, total: images.length })}
                className={cn(
                  'relative block size-16 overflow-hidden rounded-lg border bg-surface transition-colors',
                  active
                    ? 'border-forest-800 bg-forest-100'
                    : 'border-transparent ring-1 ring-line hover:ring-forest-500/40',
                )}
              >
                <ProductImage
                  path={image.path}
                  alt=""
                  /* A 64px tile at every breakpoint; the default would fetch a 640px variant. */
                  sizes="64px"
                  className="absolute inset-0 size-full p-1"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
