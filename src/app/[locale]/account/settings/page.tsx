import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChangePasswordForm, ProfileForm } from '@/features/auth/components/settings-forms';
import { getProfile } from '@/features/auth/queries';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'account.settings',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * docs/05 §14 — name, phone, locale preference, marketing opt-in, change password.
 *
 * Account deletion is also specified there; it creates a support ticket via
 * `contact_messages` and needs the contact feature from M8, so it is not stubbed here.
 */
export default async function AccountSettingsPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));

  const profile = await getProfile();
  const t = await getTranslations('account.settings');

  if (!profile) return null;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('profileTitle')}</CardTitle>
          <CardDescription>{t('profileSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm profile={profile} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('passwordTitle')}</CardTitle>
          <CardDescription>{t('passwordSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
