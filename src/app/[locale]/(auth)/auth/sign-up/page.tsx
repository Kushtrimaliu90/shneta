import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignUpForm } from '@/features/auth/components/sign-up-form';
import { OAuthButtons } from '@/features/auth/components/oauth-buttons';
import { getInviteCodeFromCookie } from '@/features/referrals/queries';

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
  /*
   * Read on the server because the cookie is `httpOnly` (docs/17 §1) — deliberately, so no script can
   * read the invite or swap it for another one. Reading it here also makes the page dynamic, which it
   * already is: a sign-up form is never cached.
   */
  const inviteCode = await getInviteCodeFromCookie();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <SignUpForm next={next} inviteCode={inviteCode} />
        {/*
          An invite code the visitor arrived with still counts if they register with Google: the code
          cannot ride in OAuth metadata, so `/api/auth/callback` claims it from the cookie afterwards.
          See the note there.
        */}
        <OAuthButtons next={next} />
      </CardContent>
    </Card>
  );
}
