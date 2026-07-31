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
  disabled,
  ...props
}: ButtonProps & { loadingLabel?: string }) {
  const { pending } = useFormStatus();

  return (
    /*
     * `disabled` is destructured out of props and recombined here on purpose. Left in the
     * spread it would land AFTER this attribute and win — so any caller passing
     * `disabled={false}` (the add-to-cart button, whenever the variant is in stock) silently
     * turned off the pending guard, and the button stayed clickable for the whole round trip.
     * That is the half of double-submit safety this component exists to provide.
     */
    <Button type="submit" {...props} disabled={pending || disabled} aria-busy={pending}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {pending && loadingLabel ? loadingLabel : children}
    </Button>
  );
}
