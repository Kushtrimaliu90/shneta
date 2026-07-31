import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { MailCheck } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'auth.verify',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** Landing page for "check your email" (docs/05 §15). Static — it reads nothing. */
export default async function VerifyPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const t = await getTranslations('auth.verify');

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <MailCheck className="size-9 text-forest-500" aria-hidden="true" />
        <h1 className="font-display text-xl font-semibold text-forest-900">{t('title')}</h1>
        <p className="max-w-sm text-sm text-ink-600">{t('body')}</p>
        <Link href="/auth/sign-in" className={`${buttonVariants({ variant: 'secondary' })} mt-2`}>
          {t('backToSignIn')}
        </Link>
      </CardContent>
    </Card>
  );
}
