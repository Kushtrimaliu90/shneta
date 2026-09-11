import { getImageProps } from 'next/image';

/**
 * Two crops, ONE download (owner cost report, 2026-09-11).
 *
 * The hero and the placement banner used to render two stacked `<Image fill>` elements — a
 * mobile crop and a desktop crop — and let CSS hide the wrong one. CSS hides pixels, not
 * requests: with `priority` on both, next/image emitted two `<link rel="preload">` tags that no
 * media attribute can be attached to, so every phone downloaded the desktop creative and every
 * desktop the mobile one — 150-300 KB of Fast Data Transfer per view for an image nobody sees,
 * on the two most-viewed surfaces of the site.
 *
 * `<picture>` is the platform's answer: the browser evaluates the `<source media>` query BEFORE
 * fetching and downloads exactly one candidate. `getImageProps` keeps every crop on the Vercel
 * optimizer with the same srcset/quality pipeline `<Image>` would use, and the preload `<link>`s
 * (React hoists them into <head>) carry the `media` attribute next/image's own preload cannot —
 * so the LCP image is still preloaded, but only the crop this viewport will render.
 *
 * One `alt` by construction: a `<picture>` has a single `<img>`. The two crops are the same
 * creative, so the copy does not differ by viewport in practice.
 */
export function ArtDirectedImage({
  mobileSrc,
  desktopSrc,
  alt,
  /** The min-width at which the desktop crop takes over, e.g. '(min-width: 1024px)'. */
  media,
  mobileSizes,
  desktopSizes,
  priority = false,
  className,
}: {
  mobileSrc: string;
  desktopSrc: string;
  alt: string;
  media: string;
  mobileSizes: string;
  desktopSizes: string;
  priority?: boolean;
  className?: string;
}) {
  const desktop = getImageProps({
    src: desktopSrc,
    alt,
    fill: true,
    sizes: desktopSizes,
  }).props;
  const mobile = getImageProps({
    src: mobileSrc,
    alt,
    fill: true,
    sizes: mobileSizes,
  }).props;

  /* `not all and ${media}` is the standard complement — it matches exactly when `media` does not. */
  const mobileMedia = `not all and ${media}`;

  return (
    <>
      {priority && (
        <>
          <link
            rel="preload"
            as="image"
            media={mobileMedia}
            imageSrcSet={mobile.srcSet}
            imageSizes={mobile.sizes}
          />
          <link
            rel="preload"
            as="image"
            media={media}
            imageSrcSet={desktop.srcSet}
            imageSizes={desktop.sizes}
          />
        </>
      )}
      <picture>
        <source media={media} srcSet={desktop.srcSet} sizes={desktop.sizes} />
        <img
          {...mobile}
          alt={alt}
          className={className}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
        />
      </picture>
    </>
  );
}
