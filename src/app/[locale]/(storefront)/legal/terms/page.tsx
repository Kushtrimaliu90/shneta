import type { Metadata } from 'next';
import { StaticPageBody, staticPageMetadata } from '@/features/content/components/static-page';

type Props = { params: Promise<{ locale: string }> };

// Keep in sync with `STATIC_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 86400;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return staticPageMetadata('terms', (await params).locale);
}

/** docs/05 §16 — terms of sale. */
export default async function Page({ params }: Props) {
  return <StaticPageBody slug="terms" locale={(await params).locale} />;
}
