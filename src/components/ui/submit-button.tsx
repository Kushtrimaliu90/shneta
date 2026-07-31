'use client';

import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';

/**
 * docs/04 §6 — the button shows a spinner and disables while its form is submitting.
 *
 * Reads `useFormStatus` rather than taking a `pending` prop, so it works inside any form
 * without the parent threading state down — and, critically, it stays disabled during the
 * server round trip, which is half of what makes checkout double-submit-safe (docs/05 §12).
 */
export function SubmitButton({
  children,
  loadingLabel,
  ...props
}: ButtonProps & { loadingLabel?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {pending && loadingLabel ? loadingLabel : children}
    </Button>
  );
}
