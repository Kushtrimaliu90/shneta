'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Heart } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { toggleWishlist } from '@/features/wishlist/actions';
import { useWishlist } from '@/features/wishlist/components/wishlist-provider';
import { cn } from '@/lib/utils';

/**
 * docs/05 §3 — the heart, on a product card and on the PDP.
 *
 * State comes from `WishlistProvider` rather than a prop, because the pages that render hearts
 * are statically cached: the server has no idea who is looking, so the saved set is fetched once
 * per page after mount and shared by every heart on it. One request for a grid of twenty-four
 * cards rather than twenty-four.
 *
 * A logged-out visitor is sent to sign-in with a return path instead of being told "sign in" and
 * left where they were — the intent was to save the product, and the shop should carry it.
 */
export function WishlistButton({
  productId,
  productName,
  returnPath,
  variant = 'icon',
  className,
}: {
  productId: string;
  productName: string;
  returnPath: string;
  variant?: 'icon' | 'labelled';
  className?: string;
}) {
  const t = useTranslations('wishlist');
  const router = useRouter();
  const { isSaved, setSaved, isSignedIn, ready } = useWishlist();
  const [pending, startTransition] = useTransition();

  const saved = isSaved(productId);
  const label = saved ? t('remove') : t('add');

  function toggle() {
    if (!ready) return;
    if (!isSignedIn) {
      router.push(`/auth/sign-in?next=${encodeURIComponent(returnPath)}`);
      return;
    }

    // Optimistic: the heart fills immediately and rolls back if the write fails.
    setSaved(productId, !saved);

    startTransition(async () => {
      const form = new FormData();
      form.set('productId', productId);
      if (saved) form.set('saved', 'true');
      const result = await toggleWishlist(null, form);
      if (result && !result.ok) setSaved(productId, saved);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending || !ready}
      aria-pressed={saved}
      // The product name is in the label, because a grid of cards otherwise announces
      // twenty-four identical "Save to wishlist" buttons.
      aria-label={`${label}: ${productName}`}
      title={label}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md transition-colors',
        variant === 'icon'
          ? 'size-9 justify-center bg-surface/90 text-carbon-800 hover:bg-surface'
          : 'h-11 px-3 text-sm font-medium text-carbon-800 hover:bg-carbon-50',
        className,
      )}
    >
      <Heart className={cn('size-5', saved && 'fill-error text-error')} aria-hidden="true" />
      {variant === 'labelled' && <span>{saved ? t('saved') : t('add')}</span>}
    </button>
  );
}
