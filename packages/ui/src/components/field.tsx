import { useId, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface FieldProps {
  label: string;
  /** Rendered with the generated id and the a11y attributes wired up. */
  children: (control: {
    id: string;
    'aria-invalid'?: true;
    'aria-describedby'?: string;
  }) => ReactNode;
  error?: string;
  hint?: string;
  optional?: boolean;
  className?: string;
}

/** Label + control + hint/error, with accessible associations. */
export function Field({ label, children, error, hint, optional, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
        {optional && <span className="ml-1 font-normal text-text-muted">(optional)</span>}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
