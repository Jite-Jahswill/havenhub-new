import type { HTMLAttributes } from 'react';

import { cn } from '../lib/cn';

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface-secondary text-text-secondary',
  primary: 'bg-primary-subtle text-primary-text',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  error: 'bg-error-subtle text-error',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
