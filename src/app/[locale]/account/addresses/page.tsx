import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { Locale } from '@/lib/constants';
import { getCurrentUser } from '@/features/auth/queries';
import { listAddresses } from '@/features/account/addresses';
import { AddressBook } from '@/features/account/components/address-book';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account.addresses' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * docs/05 §14 — the address book.
 *
 * Named in M5's account navigation and shipped here (docs/14 §10). The `/account` layout already
 * guards the section; the redirect below is the belt to that layout's braces and narrows the type
 * for nothing else — `listAddresses` is scoped by RLS, not by this check.
 */
export default async function AddressesPage({ params }: Props) {
  const [{ locale }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user) redirect(locale === 'sq' ? '/auth/sign-in' : `/${locale}/auth/sign-in`);

  const [t, addresses] = await Promise.all([
    getTranslations('account.addresses'),
    listAddresses(),
  ]);

  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-carbon-900">{t('title')}</h2>
      <p className="mt-1 mb-5 text-sm text-ink-600">{t('intro')}</p>

      <AddressBook addresses={addresses} />
    </div>
  );
}
