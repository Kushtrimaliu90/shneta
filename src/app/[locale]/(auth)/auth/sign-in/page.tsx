import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignInForm } from '@/features/auth/components/sign-in-form';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'auth.signIn',
  });
  // docs/08 §4 — auth surfaces are never indexed.
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function SignInPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const { next, error } = await searchParams;
  const t = await getTranslations('auth.signIn');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <SignInForm next={next} linkError={error === 'link_invalid'} />
      </CardContent>
    </Card>
  );
}
