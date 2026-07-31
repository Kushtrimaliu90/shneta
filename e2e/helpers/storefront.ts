import { expect, type Page } from '@playwright/test';

/**
 * Storefront actions shared by more than one spec.
 *
 * Extracted when `admin.spec.ts` needed an order to operate on. Copying the checkout walk into a
 * second file would have meant two definitions of "place an order" drifting apart — and the
 * admin journey depends on the *result* of that walk, not on its steps, so it should not own
 * them.
 */

/** Generous, because these actions are round trips to a database on another continent. */
export const ACTION_TIMEOUT = 30_000;

/** €9.90, in stock, default variant purchasable — the simplest honest basket. */
export const CHEAP_PRODUCT = '/en/product/now-vitamin-d3-4000';
export const CHEAP_SKU = 'NOW-D3-120';
/** €9.90 plus €2.00 standard delivery. */
export const CHEAP_ORDER_TOTAL = '€11.90';

export async function addCheapItemToCart(page: Page) {
  await page.goto(CHEAP_PRODUCT);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('Added to your cart.')).toBeVisible({ timeout: ACTION_TIMEOUT });
}

/**
 * Fills every required checkout field but does not submit.
 *
 * Located by `name`, not by label: `Field` appends a decorative `*` inside the `<label>`, so the
 * label text is "Email*" and both exact and substring matching get awkward ("Address" also
 * matches "Address line 2"). Scoped to `#main` because the footer newsletter input is also
 * `name="email"`.
 */
export async function fillCheckout(page: Page, email: string) {
  const form = page.locator('#main');

  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="phone"]').fill('044123456');
  await form.locator('input[name="shipping.recipientName"]').fill('Test Blerësi');
  await form.locator('input[name="shipping.phone"]').fill('044123456');
  await form.locator('input[name="shipping.line1"]').fill('Rruga B, nr. 12');
  await form.locator('input[name="shipping.city"]').fill('Prishtinë');
  await form.locator('input[name="terms"]').check();
}

export const ORDER_NUMBER = /SH-\d{4}-\d{6}-[A-Z0-9]{4}/;

/** Places a complete guest COD order and returns its number. */
export async function placeGuestOrder(page: Page, email: string): Promise<string> {
  await addCheapItemToCart(page);
  await page.goto('/en/checkout');
  await fillCheckout(page, email);
  await page.getByRole('button', { name: 'Place order' }).click();

  await expect(page.getByRole('heading', { name: 'Your order is in' })).toBeVisible({
    timeout: ACTION_TIMEOUT,
  });

  const orderNumber = (await page.getByText(ORDER_NUMBER).first().textContent())?.trim() ?? '';
  expect(orderNumber, 'placed order should have a readable number').toMatch(ORDER_NUMBER);
  return orderNumber;
}
