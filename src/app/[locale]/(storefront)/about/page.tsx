import type { Metadata } from 'next';
import { StaticPageBody, staticPageMetadata } from '@/features/content/components/static-page';

type Props = { params: Promise<{ locale: string }> };

// Keep in sync with `STATIC_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 86400;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return staticPageMetadata('about', (await params).locale);
}

/** docs/05 §16 — the story page. */
export default async function Page({ params }: Props) {
  return <StaticPageBody slug="about" locale={(await params).locale} />;
}
