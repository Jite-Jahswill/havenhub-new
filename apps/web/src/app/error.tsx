'use client';

import { ErrorState } from '@/components/error-state';

/** Errors in any page below the root layout. */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorState digest={error.digest} retry={retry} />;
}
