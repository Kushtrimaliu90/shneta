'use client';

import { useActionState, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy, RefreshCw, ShoppingBag } from 'lucide-react';
import { formatPrice } from '@/lib/money';
import type { Locale } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  addProtocolToCart,
  saveProtocol,
  type ProtocolActionState,
  type ProtocolErrorKey,
} from '@/features/biohack/actions';

/**
 * docs/15 §1 — the sticky footer: total, add-all, save, subscribe, share.
 *
 * Four actions, three of them forms. `useActionState` for each rather than one shared reducer,
 * because "added 4 of 5" and "saved" are different messages about different things and merging
 * them would mean the last one always overwrites the other.
 *
 * The variant ids come in as a prop from the view's live state, so the footer always posts what
 * is currently on screen — a removed item is not in the cart, a swapped one is.
 */
export function ProtocolActions({
  variantIds,
  totalCents,
  shareCode,
  shareUrl,
  canSave,
  signInHref,
}: {
  variantIds: string[];
  totalCents: number;
  shareCode: string | null;
  shareUrl: string | null;
  canSave: boolean;
  signInHref?: string;
}) {
  const t = useTranslations('biohack');
  const locale = useLocale() as Locale;

  /** The layout's bottom stack. Resolved after mount; see the note on `bar` below. */
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById('bottom-stack-slot')), []);

  const [cartState, cartAction] = useActionState<ProtocolActionState, FormData>(
    addProtocolToCart,
    null,
  );
  const [saveState, saveActionFn] = useActionState<ProtocolActionState, FormData>(
    saveProtocol,
    null,
  );

  const ids = variantIds.join(',');

  /*
   * One status line, from whichever action reported last, written out as branches rather than
   * assembled from a key variable. next-intl types `t` against the message tree, so a computed
   * key would have to be widened to `string` and would give up the guarantee that every key in
   * this file exists — the same reason the trace map is `as const`.
   */
  let message: { text: string; tone: 'error' | 'success' } | null = null;

  if (saveState?.ok) message = { text: t('saveDone'), tone: 'success' };
  else if (saveState) message = { text: t('errorSave'), tone: 'error' };
  else if (cartState?.ok) {
    const added = cartState.data.added ?? 0;
    const requested = cartState.data.requested ?? added;
    message =
      added < requested
        ? { text: t('addAllPartial', { count: added, total: requested }), tone: 'error' }
        : { text: t('addAllDone', { count: added }), tone: 'success' };
  } else if (cartState) {
    message = { text: cartError(cartState.error, t), tone: 'error' };
  }

  /*
   * Rendered into the layout's bottom stack, not fixed on its own.
   *
   * Fixing it independently put it under the consent banner on mobile and made the primary CTA
   * unclickable — the same defect docs/13 §N8 records for the compare bar, which is why the stack
   * exists. The trade is that the bar is not in the server-rendered HTML: it appears on mount.
   * Acceptable here and nowhere else, because swap, remove and the running total are all client
   * state anyway, so this page has no meaningful no-JavaScript rendering to protect.
   *
   * Opaque, not translucent: `bg-surface/85` with a blur looks better and fails contrast the
   * moment it rests over the dark footer, because the effective background is then whatever is
   * behind it. A pinned bar cannot promise AA against a background it does not control.
   */
  const bar = (
    <div className="border-t border-line bg-surface shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-3 sm:px-6">
        {message && (
          <p
            role="status"
            className={cn('text-sm', message.tone === 'error' ? 'text-error' : 'text-forest-800')}
          >
            {message.text}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <p className="mr-auto flex items-baseline gap-1.5" data-numeric>
            <span className="font-display text-xl font-semibold text-forest-900">
              {formatPrice(totalCents, locale)}
            </span>
            <span className="text-xs text-ink-600">{t('perMonth')}</span>
          </p>

          {/* Share sits first in the DOM but last visually: it is the least consequential
              action and should not be the first thing keyboard focus lands on after the total. */}
          {shareUrl && <ShareButton url={shareUrl} className="order-last" />}

          <form action={cartAction}>
            <input type="hidden" name="variantIds" value={ids} />
            <input type="hidden" name="subscribe" value="1" />
            <SubmitButton variant="secondary" disabled={variantIds.length === 0}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {t('subscribe')}
            </SubmitButton>
          </form>

          {canSave ? (
            shareCode && (
              <form action={saveActionFn}>
                <input type="hidden" name="code" value={shareCode} />
                <SubmitButton variant="secondary">{t('save')}</SubmitButton>
              </form>
            )
          ) : (
            signInHref && (
              <a href={signInHref} className={buttonVariants({ variant: 'secondary' })}>
                {t('saveSignIn')}
              </a>
            )
          )}

          <form action={cartAction}>
            <input type="hidden" name="variantIds" value={ids} />
            <SubmitButton size="lg" disabled={variantIds.length === 0}>
              <ShoppingBag className="size-4" aria-hidden="true" />
              {t('addAll')}
            </SubmitButton>
          </form>
        </div>
      </div>
    </div>
  );

  // Null on the server and on the first client render, so hydration matches.
  return slot ? createPortal(bar, slot) : null;
}

/** The action's error union → its message, exhaustively. A new key fails the build here. */
function cartError(
  key: ProtocolErrorKey,
  t: ReturnType<typeof useTranslations<'biohack'>>,
): string {
  switch (key) {
    case 'biohack.addAllEmpty':
      return t('addAllEmpty');
    case 'biohack.errorSubscribe':
      return t('errorSubscribe');
    case 'biohack.errorSave':
      return t('errorSave');
    case 'biohack.errorAddToCart':
      return t('errorAddToCart');
    default:
      return t('errorGeneric');
  }
}

/**
 * Copies the share URL.
 *
 * `navigator.clipboard` needs a secure context and a user gesture; both hold here. When it is
 * unavailable the button falls back to selecting nothing and simply reports failure rather than
 * pretending — a "copied!" that copied nothing is worse than no button.
 */
function ShareButton({ url, className }: { url: string; className?: string }) {
  const t = useTranslations('biohack');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant="ghost"
      className={className}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(url)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      {copied ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
      <span aria-live="polite">{copied ? t('shareCopied') : t('share')}</span>
    </Button>
  );
}
