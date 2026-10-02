import { ErrorCode, type ApiError } from '@havenhub/shared';
import { Alert } from '@havenhub/ui';
import Link from 'next/link';

/**
 * Shows an API error; plan-limit errors get a clear way forward to the plan
 * comparison page. The limit itself is enforced by the API — this is only
 * the explanation.
 */
export function ApiErrorAlert({ error }: { error: ApiError | null }) {
  if (!error) return null;
  if (error.code !== ErrorCode.PLAN_LIMIT_REACHED)
    return <Alert tone="error">{error.message}</Alert>;
  return (
    <Alert
      tone="warning"
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
    >
      <span>{error.message}</span>
      <Link
        href="/agent/subscription/plans"
        className="shrink-0 font-semibold text-text underline underline-offset-4"
      >
        View plans
      </Link>
    </Alert>
  );
}
