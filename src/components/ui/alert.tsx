import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'error' | 'success' | 'warning' | 'info';

const TONE = {
  error: { icon: AlertTriangle, className: 'border-error/30 bg-error/5 text-ink-900' },
  success: { icon: CheckCircle2, className: 'border-success/30 bg-success/5 text-ink-900' },
  /*
   * `warning` is not `error`: it marks something the user may well have meant, where `error` marks
   * something that failed. The merchant offer form is what asked for it — asking more than settlement
   * pays is a legitimate thing to submit and a bad thing to submit silently — and reaching for `error`
   * would have told a merchant their form was broken when it was not.
   */
  warning: { icon: AlertTriangle, className: 'border-warning/40 bg-warning/5 text-ink-900' },
  info: { icon: Info, className: 'border-forest-500/30 bg-forest-50 text-ink-900' },
} as const;

/**
 * Form-level feedback (docs/04 §9). `role="alert"` for errors so screen readers announce
 * them immediately; `role="status"` for the calmer tones, which should not interrupt.
 *
 * docs/04 §10 — colour is never the only carrier of meaning, hence the icon.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: toneClass } = TONE[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-md border p-3.5 text-sm', toneClass, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-ink-600')}>{children}</div>}
      </div>
    </div>
  );
}
