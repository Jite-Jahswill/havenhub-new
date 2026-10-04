'use client';

import { ErrorState } from '@/components/error-state';

import './globals.css';

/**
 * Errors in the root layout itself. Replaces the whole document, so it brings
 * its own <html>/<body> and the global styles (light theme tokens).
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en-NG">
      <body className="min-h-dvh bg-background font-sans text-text">
        <title>Something went wrong · HavenHub</title>
        <ErrorState
          digest={error.digest}
          retry={retry}
          description="HavenHub could not be loaded. Please try again in a moment."
        />
      </body>
    </html>
  );
}
