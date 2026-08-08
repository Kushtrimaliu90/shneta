import type { Metadata } from 'next';
import { StaticPageBody, staticPageMetadata } from '@/features/content/components/static-page';

type Props = { params: Promise<{ locale: string }> };

// Keep in sync with `STATIC_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 86400;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return staticPageMetadata('privacy', (await params).locale);
}

/** docs/05 §16 — the privacy policy the cookie banner links to. */
export default async function Page({ params }: Props) {
  return <StaticPageBody slug="privacy" locale={(await params).locale} />;
}
