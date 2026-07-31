'use client';

import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { signOut } from '@/features/auth/actions';
import { SubmitButton } from '@/components/ui/submit-button';

/** A form, not an onClick — sign-out is a state change and must not be a GET link. */
export function SignOutButton() {
  const t = useTranslations('account');

  return (
    <form action={signOut}>
      <SubmitButton variant="ghost" size="sm" loadingLabel={t('signingOut')}>
        <LogOut className="size-4" aria-hidden="true" />
        {t('signOut')}
      </SubmitButton>
    </form>
  );
}
