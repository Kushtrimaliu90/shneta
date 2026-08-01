import type { Metadata } from 'next';
import { StaticPageBody, staticPageMetadata } from '@/features/content/components/static-page';

type Props = { params: Promise<{ locale: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return staticPageMetadata('shipping-returns', (await params).locale);
}

/** docs/05 §16 — shipping and returns. */
export default async function Page({ params }: Props) {
  return <StaticPageBody slug="shipping-returns" locale={(await params).locale} />;
}
