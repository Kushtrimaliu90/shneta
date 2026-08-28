import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResetPasswordForm } from '@/features/auth/components/password-forms';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'auth.resetPassword',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * Reached only through a recovery link, which `/api/auth/callback` has already exchanged
 * for a session. The action re-checks that a session exists and returns
 * `auth.errors.resetLinkInvalid` if the link expired, so an expired link fails with an
 * explanation rather than a silent no-op.
 */
export default async function ResetPasswordPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const { next } = await searchParams;
  const t = await getTranslations('auth.resetPassword');

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="text-2xl">{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm next={next} />
      </CardContent>
    </Card>
  );
}
