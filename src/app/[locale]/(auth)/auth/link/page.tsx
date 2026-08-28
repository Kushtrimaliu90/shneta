import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { clientEnv } from '@/lib/env.client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MagicLinkForm } from '@/features/auth/components/password-forms';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'auth.magicLink',
  });
  // docs/08 §4 — auth surfaces are never indexed.
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * docs/05 §15.2 — sign in by emailed link.
 *
 * `notFound()` rather than a disabled form when the flag is off, and the reason is that a route is
 * discoverable in ways a button is not: the sign-in page hides its link, but somebody with the URL in
 * their history, or a crawler that saw it once, still arrives. A page that renders a form which cannot
 * send an email is worse than one that admits it does not exist — see `env.client.ts` for why this
 * ships dark until the mailer is configured.
 */
export default async function MagicLinkPage({ params, searchParams }: Props) {
  if (!clientEnv.NEXT_PUBLIC_MAGIC_LINK_ENABLED) notFound();

  setRequestLocale(resolveLocale((await params).locale));
  const { next } = await searchParams;
  const t = await getTranslations('auth.magicLink');

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="text-2xl">{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <MagicLinkForm next={next} />
      </CardContent>
    </Card>
  );
}
