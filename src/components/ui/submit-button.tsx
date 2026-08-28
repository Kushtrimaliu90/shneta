'use client';

import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from '@/components/ui/button';
import { VitalityRing } from '@/components/shared/vitality-ring';

/**
 * docs/04 §6 — the button shows the vitality spinner and disables while its form is submitting.
 *
 * Reads `useFormStatus` rather than taking a `pending` prop, so it works inside any form
 * without the parent threading state down — and, critically, it stays disabled during the
 * server round trip, which is half of what makes checkout double-submit-safe (docs/05 §12).
 *
 * The spinner is the real `<VitalityRing>` at a quarter arc, spun by its own class — docs/04
 * §2's table forbids "close enough" redraws of the signature device, which is what the
 * lucide `Loader2` this used to render was. The spin is `motion-safe:` only; a reduced-motion
 * visitor gets a static quarter ring beside the (loading) label, which together with
 * `aria-busy` still reads as "working" without anything turning. Tone follows the ground:
 * `primary` (the default) and `destructive` are dark fills, the rest sit on light surfaces —
 * see the `TONES` note in vitality-ring.tsx.
 */
export function SubmitButton({
  children,
  loadingLabel,
  disabled,
  variant,
  ...props
}: ButtonProps & { loadingLabel?: string }) {
  const { pending } = useFormStatus();
  const onLight = variant === 'secondary' || variant === 'ghost' || variant === 'link';

  return (
    /*
     * `disabled` is destructured out of props and recombined here on purpose. Left in the
     * spread it would land AFTER this attribute and win — so any caller passing
     * `disabled={false}` (the add-to-cart button, whenever the variant is in stock) silently
     * turned off the pending guard, and the button stayed clickable for the whole round trip.
     * That is the half of double-submit safety this component exists to provide.
     */
    <Button
      type="submit"
      variant={variant}
      {...props}
      disabled={pending || disabled}
      aria-busy={pending}
    >
      {pending && (
        <VitalityRing
          value={0.25}
          size={18}
          strokeWidth={2.5}
          animate={false}
          tone={onLight ? 'on-light' : 'on-dark'}
          className="size-4.5 motion-safe:animate-spin"
        />
      )}
      {pending && loadingLabel ? loadingLabel : children}
    </Button>
  );
}
