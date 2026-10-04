'use client';

import { Button, Container, buttonClasses } from '@havenhub/ui';
import Link from 'next/link';

/** Next.js gives server errors an opaque id (`digest`) that matches the server logs. */
const safeReference = (digest: string | undefined) =>
  digest && /^[A-Za-z0-9_-]{1,64}$/.test(digest) ? digest : null;

/**
 * The branded "something went wrong" screen used by every error boundary.
 * It never renders the error's message or stack — they can carry database,
 * provider or internal details — only a generic explanation, the opaque
 * reference for support, a retry, and a way back.
 */
export function ErrorState({
  title = 'Something went wrong',
  description = 'This page could not be loaded. Please try again in a moment.',
  digest,
  retry,
  home = { href: '/', label: 'Go to the homepage' },
}: {
  title?: string;
  description?: string;
  digest?: string;
  retry: () => void;
  home?: { href: string; label: string };
}) {
  const reference = safeReference(digest);
  return (
    <Container className="max-w-xl py-24 text-center" role="alert">
      <h1 className="text-2xl font-bold text-text">{title}</h1>
      <p className="mt-3 text-text-secondary">{description}</p>
      {reference && (
        <p className="mt-2 text-xs text-text-muted">
          Reference: <span className="font-mono">{reference}</span>
        </p>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Link href={home.href} className={buttonClasses({ variant: 'secondary' })}>
          {home.label}
        </Link>
      </div>
    </Container>
  );
}
