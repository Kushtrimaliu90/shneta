'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ArrowRight, Check, Loader2, ShoppingBag, X } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { addToCartAction, type CartResult } from '@/features/cart/actions';
import { notifyCartChanged } from '@/features/cart/cart-events';
import { cn } from '@/lib/utils';

/**
 * docs/04 §6 — quick add on the product card: a hover-reveal band on desktop, a persistent
 * icon button on touch.
 *
 * Two components, one contract with the card:
 *
 *   · `QuickAdd` is a **real form** posting the same `addToCart` server action the PDP's BuyBox
 *     posts, so it works before hydration and never invents client-side cart state. The card
 *     renders it only for a product with **exactly one** active variant — for anything else
 *     `QuickAddLink` sends the shopper to the PDP to choose, because docs/13 records a live bug
 *     born of silently defaulting a variant the customer never picked.
 *   · Both presentations sit `z-10` above the card's stretched name link, like the wishlist and
 *     compare buttons, so the card's one-stretched-link contract is untouched.
 *
 * ── The two presentations ──
 *
 * `@media (hover: hover)` decides, the same split the card's wishlist stack uses: where hovering
 * exists, a full-width band slides up over the tile's bottom edge on hover/focus-within — where
 * it does not, a permanently visible 44px icon button sits bottom-right, because a control
 * revealed by a state the device cannot produce is not a control. Only one of the two is ever
 * displayed, so only one is in the accessibility tree.
 *
 * The reveal transitions `translate`, not `transform` — Tailwind v4 compiles `translate-y-*` to
 * the standalone `translate` property, and naming `transform` in the transition list animates
 * nothing (measured on this exact card; see the note in `product-card.tsx`). Declared inside
 * `motion-safe`; the state classes still apply under reduced motion, so the band appears
 * instantly there rather than not at all.
 */

/** The desktop band. Hidden where hovering does not exist; revealed by the card's group state. */
const BAND_CLASSES = cn(
  'absolute inset-x-0 bottom-0 z-10 hidden h-11 items-center justify-center gap-2',
  'bg-forest-800 text-sm font-medium text-white hover:bg-forest-700',
  /*
   * `disabled:opacity-50` and nothing else: `disabled:pointer-events-none` here let the second
   * click of a double-click fall THROUGH the pending button onto the card's stretched name-link
   * beneath it, navigating to the PDP mid-submit. A disabled button with normal pointer-events
   * swallows that click harmlessly, which is exactly what an overlay above a stretched link needs.
   */
  'disabled:opacity-50',
  '[@media(hover:hover)]:flex',
  'translate-y-full opacity-0',
  'group-focus-within:translate-y-0 group-focus-within:opacity-100',
  'group-hover:translate-y-0 group-hover:opacity-100',
  /* One transition list — a second `transition-colors` alongside it would be a cascade race. */
  'motion-safe:transition-[translate,opacity,background-color] motion-safe:duration-[var(--duration-ui)] motion-safe:ease-[var(--ease-biocode)]',
);

/** The touch button: persistent, bottom-right, at the 44px floor (docs/04 §10). */
const ICON_CLASSES = cn(
  'absolute right-2 bottom-2 z-10 inline-flex size-11 items-center justify-center rounded-full',
  'bg-forest-800 text-white shadow-md transition-colors hover:bg-forest-700',
  /* See BAND_CLASSES: no pointer-events-none, or a double-tap falls through to the card link. */
  'disabled:opacity-50',
  '[@media(hover:hover)]:hidden',
);

/** How long the "added" confirmation holds before the control offers itself again. */
const CONFIRM_MS = 2000;
/** Failure holds longer — an error the eye has to find deserves more than a blink. */
const FAIL_MS = 4000;

/** What the control is showing on top of its resting state. */
type Flash = 'added' | 'failed' | null;

export function QuickAdd({ variantId, productName }: { variantId: string; productName: string }) {
  const t = useTranslations();
  /*
   * The server-action REFERENCE, not a client closure around it: only a server reference gets
   * the progressive-enhancement form wiring in the server HTML, which is what makes the
   * "works before hydration" contract above true. See `addToCartAction`'s comment.
   */
  const [state, formAction] = useActionState<CartResult | null, FormData>(addToCartAction, null);

  /*
   * One flash state for both outcomes, and every new result overwrites the previous one — a
   * failure landing inside the 2s "added" window used to cancel the reset timer and leave a
   * false permanent "Added ✓" on a control whose add had just been refused. Failure is also
   * VISIBLE here, not only announced: the sr-only region below covers assistive tech, but a
   * sighted shopper watching the spinner stop deserves more than a silent return to rest
   * (catalog pages are ISR-stale by design, so "out of stock" is a normal outcome, not an edge).
   */
  const [flash, setFlash] = useState<Flash>(null);
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      // Tells the navbar badge to refetch — see `CartBadge` and docs/13 §M1.
      notifyCartChanged();
      setFlash('added');
    } else {
      setFlash('failed');
    }
    const timer = setTimeout(() => setFlash(null), state.ok ? CONFIRM_MS : FAIL_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const namedLabel = t('cart.addToCartNamed', { name: productName });
  const errorLabel = state && !state.ok ? t(state.error) : null;

  return (
    /*
     * `display: contents`: the form contributes no box of its own, so both buttons position
     * against the card's image tile exactly as the wishlist stack does.
     */
    <form action={formAction} className="contents">
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="quantity" value={1} />
      <BandSubmit label={namedLabel} flash={flash} errorLabel={errorLabel} />
      <IconSubmit label={namedLabel} flash={flash} />
      {/* docs/04 §10 — cart updates are announced, success and failure alike. */}
      <span role="status" aria-live="polite" className="sr-only">
        {state ? (state.ok ? t('cart.added') : t(state.error)) : null}
      </span>
    </form>
  );
}

/**
 * The same control for a multi-variant (or unknown-variant) product: a link to the PDP, where
 * the variant choice is a real decision with a real radio group. Same geometry, same reveal.
 */
export function QuickAddLink({ slug, productName }: { slug: string; productName: string }) {
  const t = useTranslations('product');
  const named = t('chooseOptionsFor', { name: productName });

  return (
    <>
      <Link href={`/product/${slug}`} aria-label={named} className={BAND_CLASSES}>
        {t('chooseOptions')}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
      <Link href={`/product/${slug}`} aria-label={named} className={ICON_CLASSES}>
        <ArrowRight className="size-5" aria-hidden="true" />
      </Link>
    </>
  );
}

/*
 * Both buttons read `useFormStatus` — the `SubmitButton` pending pattern — rather than reusing
 * `SubmitButton` itself: its `Button` base carries sizing, radius and a colors-only transition
 * that this overlay would have to fight class-by-class, and the icon shape needs to swap its
 * glyph while pending instead of prepending a spinner beside it.
 */

function BandSubmit({
  label,
  flash,
  errorLabel,
}: {
  label: string;
  flash: Flash;
  errorLabel: string | null;
}) {
  const t = useTranslations('cart');
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      aria-label={label}
      className={cn(
        BAND_CLASSES,
        /*
         * While a result is showing, the band holds itself revealed: the pointer that clicked
         * may already have drifted off the card, and a confirmation nobody sees is no
         * confirmation. Failure wears the semantic error ground so it cannot be mistaken for
         * the resting state (white on error clears AA).
         */
        flash && 'translate-y-0 opacity-100',
        flash === 'failed' && 'bg-error hover:bg-error',
      )}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : flash === 'added' ? (
        <Check className="size-4" aria-hidden="true" />
      ) : flash === 'failed' ? (
        <X className="size-4" aria-hidden="true" />
      ) : (
        <ShoppingBag className="size-4" aria-hidden="true" />
      )}
      {pending
        ? t('adding')
        : flash === 'added'
          ? t('added')
          : flash === 'failed'
            ? (errorLabel ?? t('errors.generic'))
            : t('addToCart')}
    </button>
  );
}

function IconSubmit({ label, flash }: { label: string; flash: Flash }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      aria-label={label}
      className={cn(ICON_CLASSES, flash === 'failed' && 'bg-error hover:bg-error')}
    >
      {pending ? (
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      ) : flash === 'added' ? (
        <Check className="size-5" aria-hidden="true" />
      ) : flash === 'failed' ? (
        <X className="size-5" aria-hidden="true" />
      ) : (
        <ShoppingBag className="size-5" aria-hidden="true" />
      )}
    </button>
  );
}
