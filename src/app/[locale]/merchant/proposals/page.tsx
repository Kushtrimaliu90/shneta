import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveLocale } from '@/i18n/locale';
import { formatPrice } from '@/lib/money';
import { cn } from '@/lib/utils';
import { getMyMerchant } from '@/features/merchants/queries';
import { listProposals } from '@/features/merchants/proposal-queries';
import { ProposalForm } from '@/features/merchants/components/proposal-form';

export const metadata: Metadata = { title: 'Propozimet' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

/**
 * docs/16 §4 — asking for a product BioCode does not list.
 *
 * The screen is explicit about what a proposal is and is not: **a request, not a listing**. Merchants
 * never create products (§1), because one canonical page per product is what makes "who else has this in
 * stock?" a computable question — so the honest thing to offer is a way to ask, and to say plainly that
 * BioCode decides.
 *
 * Approval creates a **draft** product carrying the merchant's photographs (docs/16 §9) — and a draft is
 * invisible on the storefront, because publishing needs a compliance officer. So the photographs a merchant
 * sends do end up on the product page, and the price, the copy and the compliance pass still happen first.
 * What the merchant gets back is "yes, we will list this" and a note.
 */
export default async function MerchantProposalsPage({ params }: Props) {
  const locale = resolveLocale((await params).locale);
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') notFound();

  const t = await getTranslations('merchant.proposals');
  const proposals = await listProposals();

  const open = proposals.filter(
    (proposal) => proposal.status === 'pending' || proposal.status === 'needs_info',
  );

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h2 className="font-display text-xl font-semibold text-forest-900">{t('title')}</h2>
        <p className="mt-1 text-sm text-ink-600">{t('intro')}</p>
      </header>

      <section aria-labelledby="submitted" className="flex flex-col gap-3">
        <h3 id="submitted" className="font-display text-lg font-semibold text-forest-900">
          {t('yours')}
        </h3>

        {proposals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
            {t('empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {proposals.map((proposal) => (
              <li
                key={proposal.id}
                className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink-900">{proposal.productName}</p>
                    <p className="text-[13px] text-ink-500">
                      {proposal.brandName}
                      {proposal.variantName && ` · ${proposal.variantName}`} ·{' '}
                      {t('asking', {
                        amount: formatPrice(proposal.askingPriceCents, locale),
                      })}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'rounded-sm px-1.5 py-0.5 font-ui text-[11px] font-semibold whitespace-nowrap',
                      proposal.status === 'approved'
                        ? 'bg-success text-white'
                        : proposal.status === 'rejected'
                          ? 'bg-error text-white'
                          : proposal.status === 'needs_info'
                            ? 'bg-warning text-white'
                            : 'bg-ink-600 text-white',
                    )}
                  >
                    {t(`status.${proposal.status}`)}
                  </span>
                </div>

                {proposal.reviewerNote && (
                  <p className="rounded-md border border-line bg-cream p-3 text-sm text-ink-900">
                    <span className="font-medium">{t('reviewerNote')}</span> {proposal.reviewerNote}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new" className="flex flex-col gap-3">
        <h3 id="new" className="font-display text-lg font-semibold text-forest-900">
          {t('newTitle')}
        </h3>

        {/* Twenty open proposals is the cap: one merchant must not make the queue unusable. */}
        {open.length >= 20 ? (
          <p className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm text-ink-900">
            {t('tooManyOpen')}
          </p>
        ) : (
          <ProposalForm merchantId={merchant.id} />
        )}
      </section>
    </div>
  );
}
