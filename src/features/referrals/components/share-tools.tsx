'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, MessageCircle, Send, Share2 } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * docs/17 §4 — the share tools.
 *
 * ── Why WhatsApp and Viber get their own buttons ──
 *
 * The knowledge-article `ShareButton` deliberately offers one native sheet rather than a row of network
 * icons, because a content page does not need per-network scripts. This is the opposite case: in Kosovo
 * WhatsApp and Viber are how people actually talk, the native sheet does not exist on desktop, and a
 * referral that requires the sender to compose their own message mostly does not get sent.
 *
 * Neither button loads anything from those companies. They are plain `https://wa.me/…` and
 * `viber://forward?text=…` links with the message pre-written — no SDK, no pixel, nothing for the CSP
 * to allow.
 *
 * The message is a translated string, so the Albanian version is written by somebody thinking in
 * Albanian rather than assembled from an English template.
 */
export function ReferralShareTools({ code, shareUrl }: { code: string; shareUrl: string }) {
  const t = useTranslations('account.referrals');
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const message = t('shareMessage', { url: shareUrl });

  async function copy(what: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(what === 'code' ? code : shareUrl);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* No clipboard permission. Both values are on screen and selectable; nothing broke. */
    }
  }

  async function nativeShare() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: message, url: shareUrl });
        return;
      } catch {
        // Dismissed, or unsupported for this payload — fall through to the clipboard.
      }
    }
    await copy('link');
  }

  const secondary = cn(buttonVariants({ variant: 'secondary', size: 'sm' }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="eyebrow">{t('yourCode')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {/*
            `select-all` so a double-tap grabs the whole code rather than a word of it, and
            `font-display` at size so it can be read aloud across a counter.
          */}
          <code
            className="rounded-sm bg-forest-50 px-3 py-2 font-display text-xl font-semibold tracking-wider text-forest-900 select-all"
            data-numeric
          >
            {code}
          </code>
          <button type="button" onClick={() => copy('code')} className={secondary}>
            {copied === 'code' ? (
              <Check className="size-4 text-success" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied === 'code' ? t('copied') : t('copyCode')}
          </button>
        </div>
      </div>

      <div>
        <p className="eyebrow">{t('yourLink')}</p>
        {/*
          The link is shown as text as well as offered as a button. Somebody reading their own screen
          wants to know what they are about to send, and somebody on a locked-down browser where the
          clipboard is unavailable still needs a way to get it.
        */}
        <p className="mt-2 text-sm break-all text-ink-600">{shareUrl}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={nativeShare} className={secondary}>
            <Share2 className="size-4" aria-hidden="true" />
            {t('share')}
          </button>

          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={secondary}
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            WhatsApp
          </a>

          <a href={`viber://forward?text=${encodeURIComponent(message)}`} className={secondary}>
            <Send className="size-4" aria-hidden="true" />
            Viber
          </a>

          <button type="button" onClick={() => copy('link')} className={secondary}>
            {copied === 'link' ? (
              <Check className="size-4 text-success" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied === 'link' ? t('copied') : t('copyLink')}
          </button>
        </div>
      </div>
    </div>
  );
}
