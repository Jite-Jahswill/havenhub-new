import type { SVGProps } from 'react';

import { cn } from '../lib/cn';

/** HavenHub wordmark with a roof-shaped mark. Uses theme tokens, so it adapts to dark mode. */
export function Logo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 148 32"
      role="img"
      aria-label="HavenHub"
      className={cn('h-8 w-auto', className)}
      {...props}
    >
      <path
        d="M4 15.5 16 5l12 10.5V27a1 1 0 0 1-1 1h-6.5v-7.5h-9V28H5a1 1 0 0 1-1-1V15.5Z"
        fill="var(--hh-primary)"
      />
      <text
        x="36"
        y="23"
        fill="var(--hh-text)"
        fontFamily="inherit"
        fontSize="19"
        fontWeight="700"
        letterSpacing="-0.4"
      >
        HavenHub
      </text>
    </svg>
  );
}
