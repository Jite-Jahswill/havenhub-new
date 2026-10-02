import type { HTMLAttributes } from 'react';

import { cn } from '../lib/cn';

type AlertTone = 'info' | 'success' | 'warning' | 'error';

const toneClasses: Record<AlertTone, string> = {
  info: 'bg-surface-secondary text-text border-border',
  success: 'bg-success-subtle text-success border-success/20',
  warning: 'bg-warning-subtle text-warning border-warning/20',
  error: 'bg-error-subtle text-error border-error/20',
};

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
}

export function Alert({ tone = 'info', className, role, ...props }: AlertProps) {
  return (
    <div
      role={role ?? (tone === 'error' ? 'alert' : 'status')}
      className={cn(
        'rounded-control border px-4 py-3 text-sm leading-relaxed',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
