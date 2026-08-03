import type { Metadata } from 'next';
import { StaticPageBody, staticPageMetadata } from '@/features/content/components/static-page';

type Props = { params: Promise<{ locale: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return staticPageMetadata('marketplace-terms', (await params).locale);
}

/**
 * docs/16 §10 — the terms a merchant accepts at onboarding.
 *
 * A public page rather than one behind the portal, for two reasons: an applicant has to read it
 * before they have an account, and a merchant must be able to read the version they accepted after
 * their account is suspended — which is exactly when they will want to.
 */
export default async function Page({ params }: Props) {
  return <StaticPageBody slug="marketplace-terms" locale={(await params).locale} />;
}
