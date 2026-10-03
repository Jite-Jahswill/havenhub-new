import type { ApiError } from '@havenhub/shared';

export interface FieldIssue {
  path: string;
  message: string;
}

/** Maps API validation issues to `{ fieldName: message }` for forms. */
export function fieldErrors(error: ApiError | null | undefined): Record<string, string> {
  const issues = (error?.details as { issues?: FieldIssue[] } | undefined)?.issues ?? [];
  const result: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path || '_';
    result[key] ??= issue.message;
  }
  return result;
}

/** The first validation issue's message (for pages without form fields), else the error message. */
export const firstIssue = (error: ApiError): string =>
  Object.values(fieldErrors(error))[0] ?? error.message;

export const networkError: ApiError = {
  success: false,
  code: 'NETWORK_ERROR',
  message: 'We could not reach HavenHub. Please check your connection and try again.',
};
