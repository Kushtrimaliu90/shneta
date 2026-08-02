import { cn } from '@/lib/utils';

/** docs/04 §5 — surface, radius-lg, hairline border. */
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-lg border border-line bg-surface shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 p-6 pb-0', className)} {...props} />;
}

/**
 * `children` is destructured rather than spread so `jsx-a11y/heading-has-content` can see
 * that the heading has content — a heading whose text arrives only through a props spread
 * is indistinguishable from an empty one to both the linter and a screen reader.
 */
export function CardTitle({ className, children, ...props }: React.ComponentProps<'h2'>) {
  return (
    <h2 className={cn('font-display text-xl font-semibold text-carbon-900', className)} {...props}>
      {children}
    </h2>
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-sm text-ink-600', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-6', className)} {...props} />;
}
