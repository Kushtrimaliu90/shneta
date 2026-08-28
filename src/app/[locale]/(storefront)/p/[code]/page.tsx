import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createPublicClient } from '@/lib/supabase/public';
import { logger } from '@/lib/logger';
import type { Locale } from '@/lib/constants';
import { ProtocolView } from '@/features/biohack/components/protocol-view';
import { protocolViewProps } from '@/features/biohack/view-model';
import type { ProtocolResult } from '@/features/biohack/types';

type Props = { params: Promise<{ locale: Locale; code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'biohack' });

  return { title: t('shareTitle'), robots: { index: false, follow: false } };
}

/**
 * docs/15 §1 — `/p/[code]`, the read-only share page.
 *
 * Through `get_shared_protocol`, the security-definer RPC, with the **anon client**. That is the
 * point of the RPC and the reason it returns `result` alone: this page is reachable by anyone
 * with the link, so it must be impossible for it to read `inputs` — the answers about medication
 * and life stage that produced the protocol — even by accident. A service-client read here would
 * work and would put those two fields one careless `select('*')` away from a public page.
 *
 * No controls, no totals footer, no save. Someone else's protocol is something to look at and be
 * persuaded by, not something to edit; the only affordance is building your own.
 */
export default async function SharedProtocolPage({ params }: Props) {
  const { locale, code } = await params;

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc('get_shared_protocol', { p_code: code });

  if (error) {
    logger.error('shared protocol read failed', { cause: error.message });
    notFound();
  }

  const result = asResult(data);
  if (!result) notFound();

  const props = await protocolViewProps(result, locale);

  return (
    /* Width tier (docs/04 §1) — the site grid's gutters, with the protocol column capped inside it. */
    <div className="container-page py-8 lg:py-12">
      <div className="mx-auto max-w-4xl">
        <ProtocolView {...props} result={result} shareCode={null} shareUrl={null} readOnly />
      </div>
    </div>
  );
}

/** The RPC returns `jsonb`, so the shape has to be checked before it is rendered. */
function asResult(value: unknown): ProtocolResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<ProtocolResult>;
  if (!Array.isArray(candidate.items)) return null;

  return {
    ...(candidate as ProtocolResult),
    alternates: Array.isArray(candidate.alternates) ? candidate.alternates : [],
    trace: Array.isArray(candidate.trace) ? candidate.trace : [],
    metrics: candidate.metrics ?? { sq: [], en: [] },
    goalSlugs: Array.isArray(candidate.goalSlugs) ? candidate.goalSlugs : [],
  };
}
