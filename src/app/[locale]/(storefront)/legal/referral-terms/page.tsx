import type { Metadata } from 'next';
import { StaticPageBody, staticPageMetadata } from '@/features/content/components/static-page';

type Props = { params: Promise<{ locale: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return staticPageMetadata('referral-terms', (await params).locale);
}

/**
 * docs/17 §6 — what the referral programme commits both sides to.
 *
 * Public, and linked from the sign-up field as well as the account page: somebody is asked to name
 * who invited them before they have an account, so the terms have to be readable before they have one
 * too. Clause 6 is the one that matters most — it is the promise that a referrer never learns what a
 * referred customer bought, and it is enforced in the database rather than by this page.
 */
export default async function Page({ params }: Props) {
  return <StaticPageBody slug="referral-terms" locale={(await params).locale} />;
}
