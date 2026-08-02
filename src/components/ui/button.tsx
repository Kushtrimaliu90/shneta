import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * docs/04 §6 — primary / secondary / ghost / destructive, sizes 36 / 44 / 52 px.
 * The focus ring comes from the global `:focus-visible` rule in globals.css so every
 * interactive element gets the same AA-compliant indicator (docs/13 §C).
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap ' +
    'transition-colors duration-150 ease-[var(--ease-biocode)] ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        primary: 'bg-forest-800 text-white hover:bg-forest-700',
        secondary: 'border border-line-strong bg-surface text-ink-900 hover:bg-forest-50',
        ghost: 'text-forest-800 hover:bg-forest-50',
        destructive: 'bg-error text-white hover:brightness-110',
        link: 'text-forest-700 underline underline-offset-4 hover:text-forest-800',
      },
      size: {
        sm: 'h-9 px-3.5 text-sm',
        md: 'h-11 px-5 text-base',
        lg: 'h-13 px-7 text-base',
        icon: 'size-11',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, block, type, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
