import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ForgotPasswordForm } from '@/features/auth/components/password-forms';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'auth.forgotPassword',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function ForgotPasswordPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const t = await getTranslations('auth.forgotPassword');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm />
      </CardContent>
    </Card>
  );
}
