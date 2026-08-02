import type { LucideIcon } from 'lucide-react';
import { PackageSearch } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * docs/04 §9 — icon, one plain sentence, one action. Every list and detail page ships one
 * (CLAUDE.md §11), and the sentence tells the user what to do next rather than only what is
 * absent.
 */
export function EmptyState({
  icon: Icon = PackageSearch,
  title,
  body,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-16 text-center',
        className,
      )}
    >
      <Icon className="size-8 text-carbon-500" aria-hidden="true" />
      <p className="mt-4 font-display text-lg font-semibold text-carbon-900">{title}</p>
      {body && <p className="mt-2 max-w-sm text-sm text-ink-600">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
