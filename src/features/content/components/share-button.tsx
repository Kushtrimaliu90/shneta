'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Share2 } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * docs/05 §7 — share.
 *
 * The Web Share sheet where the browser has one (every phone), and copy-to-clipboard where it
 * does not (most desktops). One button rather than a row of network icons: those need each
 * network's script, they are the usual vector for third-party tracking on a content page, and
 * on mobile the native sheet already offers every app the reader actually uses.
 *
 * Both paths can fail for reasons that are not errors — the reader dismisses the sheet, or the
 * page is not on a secure origin — so a failure leaves the button as it was rather than
 * reporting something went wrong.
 */
export function ShareButton({ title }: { title: string }) {
  const t = useTranslations('knowledge');
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Dismissed, or unsupported for this payload — fall through to the clipboard.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* No clipboard permission. Nothing useful to say, and nothing broke. */
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
    >
      {copied ? (
        <Check className="size-4 text-success" aria-hidden="true" />
      ) : (
        <Share2 className="size-4" aria-hidden="true" />
      )}
      {copied ? t('shareCopied') : t('share')}
    </button>
  );
}
