import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignUpForm } from '@/features/auth/components/sign-up-form';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'auth.signUp',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function SignUpPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const { next } = await searchParams;
  const t = await getTranslations('auth.signUp');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <SignUpForm next={next} />
      </CardContent>
    </Card>
  );
}
