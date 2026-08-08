import type { Metadata } from 'next';
import { StaticPageBody, staticPageMetadata } from '@/features/content/components/static-page';

type Props = { params: Promise<{ locale: string }> };

// Keep in sync with `STATIC_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 86400;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return staticPageMetadata('shipping-returns', (await params).locale);
}

/** docs/05 §16 — shipping and returns. */
export default async function Page({ params }: Props) {
  return <StaticPageBody slug="shipping-returns" locale={(await params).locale} />;
}
