import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import { formatPrice } from '@/lib/money';
import type { Locale } from '@/lib/constants';
import { ProductImage } from '@/components/storefront/product-image';
import { QuantityStepper } from '@/features/cart/components/quantity-stepper';
import type { CartLine } from '@/features/cart/types';

/** Shared line list for the cart page and the drawer, so the two cannot drift apart. */
export async function CartLines({ lines }: { lines: CartLine[] }) {
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;

  return (
    <ul className="divide-y divide-line">
      {lines.map((line) => {
        const name = pickLocale(line.productName, locale);
        const variant = pickLocale(line.variantName, locale);

        return (
          <li key={line.id} className="flex gap-4 py-4">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-md border border-line bg-cream">
              <ProductImage
                path={line.imagePath}
                alt={name}
                sizes="80px"
                className="absolute inset-0 size-full p-1.5"
              />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-900">
                <Link href={`/product/${line.productSlug}`} className="rounded-sm hover:underline">
                  {name}
                </Link>
              </p>
              {variant && <p className="mt-0.5 text-xs text-ink-500">{variant}</p>}

              {/*
                docs/07 §3.2 — stock is not reserved by carting, so a line can go
                out of stock while it sits here. Say so now rather than at checkout.
              */}
              {line.stockStatus === 'out_of_stock' && (
                <p className="mt-1 text-xs font-medium text-error">{t('cart.lineOutOfStock')}</p>
              )}
              {line.stockStatus === 'low' && (
                <p className="mt-1 text-xs text-warning">{t('product.lowStockLine')}</p>
              )}

              <div className="mt-2 flex items-center justify-between gap-3">
                <QuantityStepper
                  lineId={line.id}
                  quantity={line.quantity}
                  maxQuantity={line.maxQuantity}
                />
                <p className="text-sm font-semibold text-forest-900" data-numeric>
                  {formatPrice(line.unitPriceCents * line.quantity, locale)}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
