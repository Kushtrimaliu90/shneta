'use client';

import { useActionState, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { pickLocale } from '@/lib/i18n';
import { formatPrice } from '@/lib/money';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { decideOffer, type OfferState } from '@/features/merchants/offer-actions';
import type { ReviewOffer } from '@/features/merchants/offer-admin-queries';

/**
 * docs/16 §5, §11 — deciding one offer.
 *
 * ── The signal this screen exists to show ──
 *
 * Three numbers, and the gap between two of them is the decision:
 *
 *   · **retail** — what the customer pays. Fixed by the catalogue; the merchant does not set it.
 *   · **due** — what settlement pays this merchant for one unit, at their commission.
 *   · **asking** — what the merchant wants for the unit.
 *
 * When asking exceeds due, routing an order to this merchant costs BioCode the difference. That is not
 * automatically a rejection — a rate can be renegotiated, and a hard-to-source product may be worth
 * it — but it is the fact a reviewer must not have to work out with a calculator, so it is stated in
 * cents and flagged.
 *
 * Admin UI is English-only (CLAUDE.md §3), so no `useTranslations` here.
 */
export function OfferReview({ offer }: { offer: ReviewOffer }) {
  const [panel, setPanel] = useState<'reject' | null>(null);

  const [state, action] = useActionState<OfferState, FormData>(
    async (previous, formData) => decideOffer(previous, formData),
    null,
  );

  const margin = offer.merchantDueCents - offer.askingPriceCents;
  const loses = margin < 0;

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold text-forest-900">
            {pickLocale(offer.productName, 'en')}
          </h3>
          <p className="text-sm text-ink-600">
            {pickLocale(offer.variantName, 'en') || offer.sku} · {offer.sku}
            {offer.merchantSku && ` · their SKU ${offer.merchantSku}`}
          </p>
          <p className="mt-1 text-sm text-ink-900">
            <span className="font-medium">{offer.merchantName}</span>{' '}
            <span className="text-ink-500">
              · {offer.commissionPct}% commission · {offer.merchantStatus}
            </span>
          </p>
        </div>

        <a
          href={`/product/${offer.productSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong px-2 py-1 text-xs text-forest-800 hover:bg-forest-50"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Product page
        </a>
      </header>

      <dl className="grid gap-3 rounded-md border border-line bg-cream p-4 text-sm sm:grid-cols-4">
        <Figure label="Retail" value={formatPrice(offer.retailPriceCents, 'en')} />
        <Figure label="Settlement pays" value={formatPrice(offer.merchantDueCents, 'en')} />
        <Figure label="They ask" value={formatPrice(offer.askingPriceCents, 'en')} />
        <Figure
          label={loses ? 'BioCode loses' : 'BioCode keeps'}
          value={formatPrice(Math.abs(margin), 'en')}
          tone={loses ? 'bad' : 'good'}
        />
      </dl>

      {loses && (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-ink-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            Their asking price is above what settlement pays at {offer.commissionPct}%. Every unit
            routed here costs {formatPrice(Math.abs(margin), 'en')}. Renegotiate the commission or
            reject.
          </span>
        </p>
      )}

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <Row label="Stock">
          {offer.stockOnHand}
          {offer.stockOnHand === 0 && (
            <span className="text-ink-500"> · invisible until restocked</span>
          )}
        </Row>
        <Row label="Handling">{offer.handlingDays} day(s)</Row>
        <Row label="Submitted">{offer.updatedAt.slice(0, 10)}</Row>
      </dl>

      {!offer.productPublished && (
        <p className="text-sm text-warning">
          The product is not published, so approving this offer puts nothing on sale.
        </p>
      )}

      {state && !state.ok && (
        <p role="alert" className="text-sm text-error">
          {state.error === 'admin.errors.forbidden'
            ? 'Reviewing offers needs the product-manager capability.'
            : state.error === 'merchant.offers.errors.locked'
              ? 'This offer moved since the page loaded. Reload and look again.'
              : 'Could not save the decision.'}
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <form action={action}>
          <input type="hidden" name="offerId" value={offer.id} />
          <input type="hidden" name="decision" value="approve" />
          <SubmitButton size="sm">Approve</SubmitButton>
        </form>

        <Button variant="destructive" size="sm" onClick={() => setPanel(panel ? null : 'reject')}>
          Reject
        </Button>
      </div>

      {panel === 'reject' && (
        <form action={action} className="flex flex-col gap-3 rounded-md border border-line bg-cream p-4">
          <input type="hidden" name="offerId" value={offer.id} />
          <input type="hidden" name="decision" value="reject" />

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Why this is rejected</span>
            <textarea
              name="note"
              rows={3}
              required
              minLength={5}
              className="rounded-md border border-line-strong bg-surface p-2.5 text-sm"
            />
            {/* The merchant reads this in the portal, so it has to say what to change. */}
            <span className="text-xs text-ink-600">
              The merchant sees this on the offer. A rejection with no reason is one they cannot fix.
            </span>
          </label>

          <div className="flex gap-2">
            <SubmitButton size="sm" variant="destructive">
              Reject offer
            </SubmitButton>
            <Button variant="ghost" size="sm" onClick={() => setPanel(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </article>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 font-display text-lg font-semibold',
          tone === 'bad' ? 'text-error' : tone === 'good' ? 'text-forest-900' : 'text-ink-900',
        )}
        data-numeric
      >
        {value}
      </dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className="text-ink-900">{children}</dd>
    </div>
  );
}
