import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { KnowledgeHub } from '@/features/content/components/knowledge-hub';

type Props = { params: Promise<{ locale: string }> };

/** docs/02 §5 — content is ISR with tag purging, like the catalogue. */
// Keep in sync with `STATIC_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 86400;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'knowledge' });

  return {
    title: t('title'),
    description: t('intro'),
    alternates: {
      canonical: '/knowledge',
      languages: { sq: '/knowledge', en: '/en/knowledge' },
    },
  };
}

/**
 * docs/05 §7 — the Knowledge Center hub, unfiltered and PRERENDERED (owner cost report,
 * 2026-09-18). This page deliberately reads no searchParams: doing so opted the whole route out
 * of the static tier its `revalidate` declares, so every hub visit — a header link on every
 * page — was a billed dynamic render. Filtered views (`?type/?tag/?page`) live at the
 * `/knowledge/f` sibling, which reads the query and stays dynamic; the shared `KnowledgeHub`
 * body keeps the two pixel-identical, and the middleware redirects legacy query URLs across.
 */
export default async function KnowledgePage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  return <KnowledgeHub />;
}
