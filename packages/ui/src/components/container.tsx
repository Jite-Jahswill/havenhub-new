import type { HTMLAttributes } from 'react';

import { cn } from '../lib/cn';

/** Centred, width-constrained page content with consistent gutters. */
export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8', className)} {...props} />
  );
}
