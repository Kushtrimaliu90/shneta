'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatPrice } from '@/lib/money';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { ProductImage } from '@/components/storefront/product-image';
import { Field } from '@/components/ui/field';
import { ActionForm, useSubmitted, useSubmittedChecked } from '@/components/ui/action-form';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { placeOrder, type CheckoutState } from '@/features/checkout/actions';
import type { Cart, ShippingMethodOption } from '@/features/cart/types';
import { cn } from '@/lib/utils';

/**
 * docs/05 §12 — the four steps: contact, delivery, payment, review.
 *
 * One form, four `<fieldset>`s, rather than a wizard with client-side step state. A single
 * submission means no half-captured order can exist, the browser can autofill the whole
 * thing at once, and it degrades to a working form without JavaScript. Each fieldset has a
 * legend, so the structure is available to a screen reader without any ARIA of ours.
 *
 * Shipping cost is recomputed here purely for display. The RPC prices the order
 * independently from the database, and `tests/unit/money.test.ts` asserts the two agree.
 */
export function CheckoutForm({
  cart,
  methods,
  providers,
  vatRatePercent,
  defaultEmail,
  defaultPhone,
  defaultName,
}: {
  cart: Cart;
  methods: ShippingMethodOption[];
  providers: ('cod' | 'bank_pos')[];
  vatRatePercent: number;
  defaultEmail?: string;
  defaultPhone?: string;
  defaultName?: string;
}) {
  const [state, formAction] = useActionState<CheckoutState, FormData>(placeOrder, null);
  const submittedNote = useSubmitted('customerNote');
  const submittedProvider = useSubmitted('paymentProvider');
  const acceptedTerms = useSubmittedChecked('terms', 'on', false);
  const t = useTranslations();
  const locale = useLocale() as Locale;

  const submittedMethodId = useSubmitted('shippingMethodId');
  const [methodId, setMethodId] = useState(
    /*
     * Seeded from the rejected submission, not just from the first method. Without this a customer who
     * chose the more expensive delivery has it silently reset to the default when the coupon is
     * refused — and the total they are about to accept is not the one they picked.
     */
    () =>
      submittedMethodId && methods.some((m) => m.id === submittedMethodId)
        ? submittedMethodId
        : (methods[0]?.id ?? ''),
  );
  const selected = methods.find((method) => method.id === methodId) ?? methods[0];

  const shippingCents =
    selected?.freeOverCents != null && cart.subtotalCents >= selected.freeOverCents
      ? 0
      : (selected?.priceCents ?? 0);
  const totalCents = cart.subtotalCents + shippingCents;
  // docs/07 §5 — VAT is broken out of a VAT-inclusive total, informationally.
  const taxCents = Math.floor(
    (2 * totalCents * Math.round(vatRatePercent * 100) +
      (10_000 + Math.round(vatRatePercent * 100))) /
      (2 * (10_000 + Math.round(vatRatePercent * 100))),
  );

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  // docs/07 §4.5 — OUT_OF_STOCK names the item so the message is actionable.
  const errorMessage =
    state && !state.ok ? (state.sku ? `${t(state.error)} (${state.sku})` : t(state.error)) : null;

  /*
   * The Alert lives at the top of the left column; on a phone the submit button is ~4 screens
   * below it, so without this a failed order looks like a dead tap. Centre the message on every
   * failure — keyed on the state object, because two consecutive failures are two objects.
   * `scroll-behavior` comes from globals.css, which already downgrades smooth scrolling under
   * `prefers-reduced-motion`, so no motion guard is needed here.
   */
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state && !state.ok) errorRef.current?.scrollIntoView({ block: 'center' });
  }, [state]);

  return (
    <ActionForm
      action={formAction}
      state={state}
      className="grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:gap-16"
      noValidate
    >
      <div className="flex flex-col gap-8">
        {errorMessage && (
          <div ref={errorRef}>
            <Alert tone="error">{errorMessage}</Alert>
          </div>
        )}

        {/* 1 — Contact */}
        <fieldset className="rounded-lg border border-line bg-surface p-5">
          <legend className="px-2 font-display text-lg font-semibold text-forest-900">
            {t('checkout.steps.contact')}
          </legend>
          <div className="mt-2 flex flex-col gap-4">
            <Field id="email" label={t('auth.fields.email')} errors={fieldErrors?.email} required>
              {(props) => (
                <Input
                  {...props}
                  name="email"
                  type="email"
                  autoComplete="email"
                  defaultValue={defaultEmail}
                />
              )}
            </Field>
            <Field
              id="phone"
              label={t('auth.fields.phone')}
              hint={t('auth.fields.phoneHint')}
              errors={fieldErrors?.phone}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  defaultValue={defaultPhone}
                />
              )}
            </Field>
          </div>
        </fieldset>

        {/* 2 — Delivery */}
        <fieldset className="rounded-lg border border-line bg-surface p-5">
          <legend className="px-2 font-display text-lg font-semibold text-forest-900">
            {t('checkout.steps.delivery')}
          </legend>
          <div className="mt-2 flex flex-col gap-4">
            <Field
              id="shipping.recipientName"
              label={t('checkout.fields.recipientName')}
              errors={fieldErrors?.['shipping.recipientName']}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  name="shipping.recipientName"
                  autoComplete="name"
                  defaultValue={defaultName}
                />
              )}
            </Field>
            <Field
              id="shipping.phone"
              label={t('checkout.fields.deliveryPhone')}
              hint={t('auth.fields.phoneHint')}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  name="shipping.phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  defaultValue={defaultPhone}
                />
              )}
            </Field>
            <Field id="shipping.line1" label={t('checkout.fields.line1')} required>
              {(props) => <Input {...props} name="shipping.line1" autoComplete="address-line1" />}
            </Field>
            <Field id="shipping.line2" label={t('checkout.fields.line2')}>
              {(props) => (
                <Input
                  {...props}
                  name="shipping.line2"
                  autoComplete="address-line2"
                  required={false}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="shipping.city" label={t('checkout.fields.city')} required>
                {(props) => <Input {...props} name="shipping.city" autoComplete="address-level2" />}
              </Field>
              <Field id="shipping.postalCode" label={t('checkout.fields.postalCode')}>
                {(props) => (
                  <Input
                    {...props}
                    name="shipping.postalCode"
                    autoComplete="postal-code"
                    required={false}
                  />
                )}
              </Field>
            </div>

            <div>
              <p className="text-sm font-medium text-ink-900">{t('checkout.method')}</p>
              <ul className="mt-2 flex flex-col gap-2">
                {methods.map((method) => (
                  <li key={method.id}>
                    <label
                      htmlFor={`method-${method.id}`}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-md border border-line-strong p-3.5 transition-colors',
                        /*
                          `has-[:checked]`, not React state: the highlight follows the native
                          checked state, so it is right before hydration too — the same
                          progressive-enhancement contract as the rest of this form. `methodId`
                          stays, but only to recompute the shipping cost in the summary.
                        */
                        'hover:bg-forest-50/50 has-[:checked]:border-forest-800 has-[:checked]:bg-forest-50',
                      )}
                    >
                      {/*
                        `accent-color` is what stops the checked mark rendering OS-blue — the only
                        non-token hue this page had. size-4 with mt-0.5 centres the 16px control
                        on the label's 20px first line.
                      */}
                      <input
                        id={`method-${method.id}`}
                        type="radio"
                        name="shippingMethodId"
                        value={method.id}
                        checked={method.id === methodId}
                        onChange={() => setMethodId(method.id)}
                        className="mt-0.5 size-4 shrink-0 accent-forest-800"
                        required
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex justify-between gap-3 text-sm font-medium text-ink-900">
                          {pickLocale(method.name, locale)}
                          <span data-numeric>
                            {method.freeOverCents != null &&
                            cart.subtotalCents >= method.freeOverCents
                              ? t('checkout.free')
                              : formatPrice(method.priceCents, locale)}
                          </span>
                        </span>
                        {/*
                          ink-600, not ink-500: a selected card is filled with forest-50,
                          and ink-500 on that tint measures 4.43:1 — under the 4.5:1 floor.
                          Asserted in tests/unit/contrast.test.ts so it cannot drift back.
                        */}
                        <span className="mt-0.5 block text-xs text-ink-600">
                          {t('checkout.eta', { min: method.minDays, max: method.maxDays })}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </fieldset>

        {/* 3 — Payment */}
        <fieldset className="rounded-lg border border-line bg-surface p-5">
          <legend className="px-2 font-display text-lg font-semibold text-forest-900">
            {t('checkout.steps.payment')}
          </legend>
          <ul className="mt-2 flex flex-col gap-2">
            {providers.map((provider) => (
              <li key={provider}>
                <label
                  htmlFor={`provider-${provider}`}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border border-line-strong p-3.5 transition-colors',
                    /*
                      Every option used to hardcode the *selected* style, so with two providers
                      both read as chosen and picking one changed nothing visibly. `has-[:checked]`
                      styles whichever radio is actually checked — including the `defaultChecked`
                      one before hydration — with no selection state of our own.
                    */
                    'hover:bg-forest-50/50 has-[:checked]:border-forest-800 has-[:checked]:bg-forest-50',
                  )}
                >
                  <input
                    id={`provider-${provider}`}
                    type="radio"
                    name="paymentProvider"
                    value={provider}
                    defaultChecked={
                      submittedProvider ? submittedProvider === provider : provider === providers[0]
                    }
                    className="mt-0.5 size-4 shrink-0 accent-forest-800"
                    required
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink-900">
                      {t(`checkout.providers.${provider}.title`)}
                    </span>
                    {/* ink-600 for the same reason as the delivery card above. */}
                    <span className="mt-0.5 block text-xs text-ink-600">
                      {t(`checkout.providers.${provider}.body`)}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {/* 4 — Review */}
        <fieldset className="rounded-lg border border-line bg-surface p-5">
          <legend className="px-2 font-display text-lg font-semibold text-forest-900">
            {t('checkout.steps.review')}
          </legend>
          <div className="mt-2 flex flex-col gap-4">
            <Field id="couponCode" label={t('checkout.fields.coupon')}>
              {(props) => <Input {...props} name="couponCode" required={false} />}
            </Field>
            <Field id="customerNote" label={t('checkout.fields.note')}>
              {(props) => (
                <textarea
                  {...props}
                  name="customerNote"
                  defaultValue={submittedNote}
                  rows={3}
                  required={false}
                  className="w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-base text-ink-900"
                />
              )}
            </Field>

            <div>
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="terms"
                  defaultChecked={acceptedTerms}
                  required
                  aria-invalid={Boolean(fieldErrors?.terms)}
                  className="mt-0.5 size-4 shrink-0 rounded-[3px] border border-line-strong accent-forest-800"
                />
                <span className="text-ink-600">{t('checkout.acceptTerms')}</span>
              </label>
              {fieldErrors?.terms && (
                <p className="mt-1 text-[13px] text-error">{t('auth.errors.termsRequired')}</p>
              )}
            </div>
          </div>
        </fieldset>
      </div>

      {/* Persistent summary (docs/05 §12) */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-lg border border-line bg-surface p-5">
          <h2 className="font-display text-lg font-semibold text-forest-900">
            {t('cart.summary')}
          </h2>

          <ul className="mt-4 flex flex-col gap-2.5 text-sm">
            {cart.lines.map((line) => (
              <li key={line.id} className="flex items-center gap-3">
                {/*
                  A thumbnail per line, so "am I buying the right thing?" is answered in the
                  review step itself rather than by scrolling back to the cart. Same bordered
                  cream tile as the cart lines, at receipt scale.
                */}
                <ProductImage
                  path={line.imagePath}
                  alt={pickLocale(line.productName, locale) || line.sku}
                  sizes="40px"
                  className="size-10 shrink-0 rounded-sm border border-line bg-cream p-1"
                />
                <span className="min-w-0 flex-1 text-ink-600">
                  {pickLocale(line.productName, locale) || line.sku}
                  <span className="text-ink-500"> × {line.quantity}</span>
                </span>
                <span className="whitespace-nowrap text-ink-900" data-numeric>
                  {formatPrice(line.unitPriceCents * line.quantity, locale)}
                </span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-600">{t('cart.subtotal')}</dt>
              <dd data-numeric>{formatPrice(cart.subtotalCents, locale)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-600">{t('cart.shipping')}</dt>
              <dd data-numeric>
                {shippingCents === 0 ? t('checkout.free') : formatPrice(shippingCents, locale)}
              </dd>
            </div>
            {/* text-xl — docs/04 §4 puts prices at 18–24px; the total is the biggest number on the page. */}
            <div className="flex items-baseline justify-between border-t border-line pt-2 text-base font-semibold">
              <dt>{t('checkout.total')}</dt>
              <dd className="text-xl" data-numeric>
                {formatPrice(totalCents, locale)}
              </dd>
            </div>
          </dl>

          <p className="mt-1 text-xs text-ink-500">
            {t('checkout.vatIncludedAmount', {
              rate: vatRatePercent,
              amount: formatPrice(taxCents, locale),
            })}
          </p>

          {/*
            A compact echo of the top Alert, because this button is where the customer is
            looking when the failure lands. `aria-hidden` — the Alert already carries the
            `role="alert"` announcement, and a second reading would be noise.
          */}
          {errorMessage && (
            <p className="mt-4 text-sm text-error" aria-hidden="true">
              {errorMessage}
            </p>
          )}

          {/*
            docs/05 §12 acceptance — double-submit safe. The button disables for the whole
            round trip, and the RPC converts the cart, so a second submission finds no active
            cart and cannot create a second order.
          */}
          <SubmitButton size="lg" block className="mt-5" loadingLabel={t('checkout.placing')}>
            {t('checkout.placeOrder')}
          </SubmitButton>

          <p className="mt-3 text-center text-xs text-ink-500">{t('cart.codNote')}</p>
        </div>
      </aside>
    </ActionForm>
  );
}
