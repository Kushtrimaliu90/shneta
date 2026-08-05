'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Gift } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { claimReferralCode, type ClaimFormState } from '@/features/referrals/actions';

/**
 * docs/17 §1 — "I have an invite code", offered until the first order.
 *
 * The card is only rendered while `canEnter` is true, so it disappears on its own rather than
 * needing to be hidden: after the first order there is nothing to claim, and a form that explains
 * why it will not work is worse than no form.
 *
 * A code arriving from `/r/{CODE}` pre-fills the field rather than being applied silently. Naming
 * who invited you is a statement about yourself and it belongs to the customer to confirm — and a
 * visible, editable field is also the only way somebody who followed the wrong link can fix it.
 */
export function ReferralCodeEntry({ suggestedCode }: { suggestedCode: string | null }) {
  const [state, formAction] = useActionState<ClaimFormState, FormData>(claimReferralCode, null);
  const t = useTranslations();

  if (state?.ok) {
    return (
      <Alert tone="success" title={t('account.referrals.claimedTitle')}>
        {t('account.referrals.claimed')}
      </Alert>
    );
  }

  /*
   * The field's message is the action's own error key, translated — not the Zod message that arrives
   * in `fieldErrors`, which is a machine string like `INVALID_REFERRAL_CODE`. `fieldErrors` is used
   * only to decide *whether* the field is in error.
   */
  const failure = state && !state.ok ? state : null;
  const fieldInvalid = Boolean(failure?.fieldErrors?.code);

  return (
    <Card>
      <CardContent>
        <div className="flex items-start gap-3">
          <Gift className="mt-0.5 size-5 shrink-0 text-forest-700" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold text-forest-900">
              {t('account.referrals.haveCodeTitle')}
            </h2>
            <p className="mt-1 text-sm text-ink-600">{t('account.referrals.haveCodeBody')}</p>

            <form action={formAction} className="mt-4 flex flex-col gap-3" noValidate>
              {failure && !fieldInvalid && <Alert tone="error">{t(failure.error)}</Alert>}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <Field
                  id="referralClaimCode"
                  label={t('account.referrals.codeLabel')}
                  hint={t('account.referrals.codeHint')}
                  errors={failure && fieldInvalid ? [t(failure.error)] : undefined}
                  className="sm:flex-1"
                >
                  {(props) => (
                    <Input
                      {...props}
                      name="code"
                      defaultValue={suggestedCode ?? ''}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={64}
                      placeholder="BIO-XXXXX"
                    />
                  )}
                </Field>

                <SubmitButton
                  variant="secondary"
                  className="sm:mt-[1.9rem]"
                  loadingLabel={t('common.loading')}
                >
                  {t('account.referrals.claimSubmit')}
                </SubmitButton>
              </div>

              <p className="text-[13px] text-ink-500">
                {t.rich('account.referrals.termsNote', {
                  terms: (chunks) => (
                    <Link
                      href="/legal/referral-terms"
                      className="text-forest-700 underline underline-offset-4"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </form>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The referee's quiet line (docs/17 §4).
 *
 * One sentence and a link to the terms. Not a dashboard: the referee earns nothing from the
 * programme and does not need a panel about it, but they should be able to see that a link exists
 * and read what it commits them to.
 */
export function ReferralSourceNote({
  referrerName,
  pending,
}: {
  referrerName: string;
  pending: boolean;
}) {
  const t = useTranslations();

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-ink-600">
      <Gift className="size-4 shrink-0 text-forest-700" aria-hidden="true" />
      {pending
        ? t('account.referrals.invitedByPending', { name: referrerName })
        : t('account.referrals.invitedBy', { name: referrerName })}
      <Link href="/legal/referral-terms" className="text-forest-700 underline underline-offset-4">
        {t('account.referrals.termsLink')}
      </Link>
    </p>
  );
}
