import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '../lib/cn';

export const controlClasses = cn(
  'w-full rounded-control border border-border-strong bg-surface px-3.5 text-sm text-text',
  'placeholder:text-text-muted transition-colors',
  'hover:border-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
  'disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:opacity-70',
  'aria-[invalid=true]:border-error aria-[invalid=true]:focus:ring-error/20',
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(controlClasses, 'h-11', className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea ref={ref} className={cn(controlClasses, 'min-h-28 py-3', className)} {...props} />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(controlClasses, 'h-11 pr-9', className)} {...props}>
        {children}
      </select>
    );
  },
);
