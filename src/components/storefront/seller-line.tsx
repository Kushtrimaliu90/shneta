'use client';

import { useTranslations } from 'next-intl';
import { Store } from 'lucide-react';
import type { VariantSupply } from '@/features/catalog/types';

/**
 * docs/16 §1 — who the customer is buying from.
 *
 * On a hybrid marketplace this is not decoration. A shopper who cannot tell whether BioCode or a
 * third party is behind a listing cannot tell who to hold to a promise about it, and the sale is
 * always **BioCode↔customer** — the merchant is a supplier, which is exactly what this line has to
 * convey without implying the customer has a contract with them (marketplace terms, clause 1).
 *
 * ── Why it renders only on a buyable variant ──
 *
 * The caller gates on availability. Naming a seller for something that cannot be added to the cart
 * would be a claim the system cannot honour: merchant supply does not become purchasable until
 * routing exists (docs/16 §12 step 4), because an order nobody can route is worse for the customer
 * than a product marked out of stock.
 *
 * `null` supply — the lookup failed, and it is allowed to fail — falls through to the BioCode line,
 * which is what a page without a marketplace said and what the stock the shopper is looking at
 * actually is.
 */
export function SellerLine({ supply }: { supply: VariantSupply | null }) {
  const t = useTranslations('product');

  const merchantName = supply?.source === 'merchant' ? supply.merchantName : null;

  return (
    <p className="flex items-start gap-2 text-sm text-ink-600">
      <Store className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden="true" />
      <span>
        {merchantName ? (
          <>
            {t('soldByMerchant', { merchant: merchantName })}
            {/*
              The handling time, when the merchant gave one. It is the honest part of a merchant
              line: the parcel leaves their shelf, not BioCode's, so the first leg is theirs.
            */}
            {typeof supply?.handlingDays === 'number' && supply.handlingDays > 0 && (
              <> · {t('handlingDays', { days: supply.handlingDays })}</>
            )}
          </>
        ) : (
          t('soldByBiocode')
        )}
      </span>
    </p>
  );
}
