import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignInForm } from '@/features/auth/components/sign-in-form';
import { OAuthButtons } from '@/features/auth/components/oauth-buttons';
import { clientEnv } from '@/lib/env.client';

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
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="text-2xl">{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/*
          Email first, social second.

          The other way round is the more common arrangement and it is wrong here: this shop already
          has customers with passwords, and burying the field they came to use under two buttons makes
          the familiar path feel like the fallback. Social is the shortcut, offered after the thing that
          already works.
        */}
        <SignInForm
          next={next}
          linkError={error === 'link_invalid'}
          oauthError={error === 'oauth' || error === 'rate'}
          magicLinkEnabled={clientEnv.NEXT_PUBLIC_MAGIC_LINK_ENABLED}
        />
        <OAuthButtons next={next} />
      </CardContent>
    </Card>
  );
}
