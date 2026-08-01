import type { Metadata } from 'next';
import { StaticPageBody, staticPageMetadata } from '@/features/content/components/static-page';

type Props = { params: Promise<{ locale: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return staticPageMetadata('terms', (await params).locale);
}

/** docs/05 §16 — terms of sale. */
export default async function Page({ params }: Props) {
  return <StaticPageBody slug="terms" locale={(await params).locale} />;
}
