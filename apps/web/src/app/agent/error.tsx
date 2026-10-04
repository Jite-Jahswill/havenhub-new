'use client';

import { ErrorState } from '@/components/error-state';

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorState
      digest={error.digest}
      retry={retry}
      home={{ href: '/agent', label: 'Back to your dashboard' }}
    />
  );
}
