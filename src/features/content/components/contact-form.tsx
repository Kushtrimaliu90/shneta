'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { ActionForm, useSubmitted } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { submitContact, type ContactState } from '@/features/content/actions';
import { cn } from '@/lib/utils';

/**
 * docs/05 §16 — the contact form.
 *
 * Field errors are message keys resolved through `t()`, like every other storefront form. The
 * honeypot is a real input positioned off-screen rather than `display:none`: some bots skip
 * hidden fields, and `sr-only` with `tabIndex={-1}` and `autoComplete="off"` keeps it out of
 * a keyboard user's path without hiding it from a naive filler.
 */
/**
 * The message key for each Zod issue code, written out in full.
 *
 * A template literal (`` t(`fieldErrors.${key}`) ``) is rejected by next-intl's types, and
 * rightly: the whole point of the typed key union is that a typo is a build error, and a
 * computed key opts out of that check. Three explicit keys cost nothing.
 */
const FIELD_MESSAGES = {
  REQUIRED: 'contact.fieldErrors.required',
  INVALID_EMAIL: 'contact.fieldErrors.invalidEmail',
  TOO_SHORT: 'contact.fieldErrors.tooShort',
} as const;

export function ContactForm() {
  const t = useTranslations('contact');
  const tRoot = useTranslations();
  const [state, formAction] = useActionState<ContactState, FormData>(submitContact, null);
  const submittedName = useSubmitted('name');
  const submittedEmail = useSubmitted('email');
  const submittedSubject = useSubmitted('subject');
  const submittedBody = useSubmitted('body');

  if (state?.ok) {
    return (
      <Alert tone="success" title={t('sentTitle')}>
        <span className="flex items-center gap-2">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          {t('sentBody')}
        </span>
      </Alert>
    );
  }

  const fieldError = (field: string): string | null => {
    if (!state || state.ok) return null;
    const issue = state.fieldErrors?.[field]?.[0];
    if (!issue) return null;
    // The schema's issue codes are identifiers; the customer needs a sentence in their language.
    const key = FIELD_MESSAGES[issue as keyof typeof FIELD_MESSAGES];
    return key ? tRoot(key) : null;
  };

  const inputClass = 'mt-1 h-11 w-full rounded-sm border bg-surface px-3 text-sm text-ink-900';

  return (
    <ActionForm action={formAction} state={state} className="flex flex-col gap-4">
      {/* Off-screen, not hidden — see the note above. */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="contact-company">Company</label>
        <input id="contact-company" name="company" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-name" className="block text-sm font-medium text-ink-900">
            {t('name')} <span className="text-error">*</span>
          </label>
          <input
            id="contact-name"
            name="name"
            defaultValue={submittedName}
            required
            autoComplete="name"
            aria-invalid={Boolean(fieldError('name'))}
            className={cn(
              inputClass,
              fieldError('name') ? 'border-2 border-error' : 'border-line-strong',
            )}
          />
          {fieldError('name') && <p className="mt-1 text-xs text-error">{fieldError('name')}</p>}
        </div>

        <div>
          <label htmlFor="contact-email" className="block text-sm font-medium text-ink-900">
            {t('email')} <span className="text-error">*</span>
          </label>
          <input
            id="contact-email"
            name="email"
            defaultValue={submittedEmail}
            type="email"
            required
            autoComplete="email"
            aria-invalid={Boolean(fieldError('email'))}
            className={cn(
              inputClass,
              fieldError('email') ? 'border-2 border-error' : 'border-line-strong',
            )}
          />
          {fieldError('email') && <p className="mt-1 text-xs text-error">{fieldError('email')}</p>}
        </div>
      </div>

      <div>
        <label htmlFor="contact-subject" className="block text-sm font-medium text-ink-900">
          {t('subject')}
        </label>
        <input
          id="contact-subject"
          name="subject"
          defaultValue={submittedSubject}
          className={cn(inputClass, 'border-line-strong')}
        />
      </div>

      <div>
        <label htmlFor="contact-body" className="block text-sm font-medium text-ink-900">
          {t('message')} <span className="text-error">*</span>
        </label>
        <textarea
          id="contact-body"
          name="body"
          defaultValue={submittedBody}
          rows={6}
          required
          minLength={10}
          aria-invalid={Boolean(fieldError('body'))}
          className={cn(
            'mt-1 w-full rounded-sm border bg-surface px-3 py-2 text-sm text-ink-900',
            fieldError('body') ? 'border-2 border-error' : 'border-line-strong',
          )}
        />
        {fieldError('body') && <p className="mt-1 text-xs text-error">{fieldError('body')}</p>}
      </div>

      <div>
        <SubmitButton loadingLabel={t('submitting')}>{t('submit')}</SubmitButton>
      </div>

      {state && !state.ok && <Alert tone="error">{tRoot(state.error)}</Alert>}
    </ActionForm>
  );
}
