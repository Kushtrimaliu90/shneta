import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/lib/constants';
import { getCurrentUser } from '@/features/auth/queries';
import { getStoredProtocol } from '@/features/biohack/queries';
import { ProtocolView } from '@/features/biohack/components/protocol-view';
import { protocolViewProps } from '@/features/biohack/view-model';

type Props = { params: Promise<{ locale: Locale; code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'biohack' });

  // Never indexed: the page is one person's protocol behind a capability URL.
  return { title: t('resultTitle'), robots: { index: false, follow: false } };
}

/**
 * docs/15 §1 step 3 — the generated protocol.
 *
 * Renders the **stored snapshot**, not a fresh generation. A customer who reopens their link
 * after the catalogue changed sees the protocol they were given; regenerating would quietly hand
 * them a different one and make "compliance can point at the version that produced it" untrue.
 *
 * Reachable by anyone holding the code, exactly like the share page — the difference is that this
 * one carries the controls. There is nothing to protect that the share page does not already
 * expose: the row's only identifying field, `inputs`, never leaves the server.
 */
export default async function ProtocolPage({ params }: Props) {
  const { locale, code } = await params;

  const user = await getCurrentUser();
  const stored = await getStoredProtocol(code, user?.id ?? null);
  if (!stored) notFound();

  const props = await protocolViewProps(stored.result, locale);
  const path = locale === 'sq' ? `/biohack/${code}` : `/${locale}/biohack/${code}`;
  const sharePath = locale === 'sq' ? `/p/${code}` : `/${locale}/p/${code}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:py-14">
      <ProtocolView
        {...props}
        result={stored.result}
        shareCode={stored.shareCode}
        shareUrl={sharePath}
        canSave={Boolean(user) && (stored.isOwn || stored.claimable)}
        signInHref={`/auth/sign-in?next=${encodeURIComponent(path)}`}
      />
    </div>
  );
}
