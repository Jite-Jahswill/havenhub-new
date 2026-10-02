'use client';

import type { ApiError, ApiResponse } from '@havenhub/shared';
import { useCallback, useState } from 'react';
import type { z } from 'zod';

import { fieldErrors } from './api/errors';

/**
 * Form/action state for API calls: pending flag, top-level error and
 * per-field errors. `validate` runs the same shared Zod schema the API uses,
 * so most mistakes are caught before a request is made.
 */
export function useApiAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const validate = useCallback(
    <S extends z.ZodType>(schema: S, values: unknown): z.output<S> | null => {
      const result = schema.safeParse(values);
      if (result.success) {
        setError(null);
        return result.data;
      }
      setError({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Please check the highlighted fields.',
        details: {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
      return null;
    },
    [],
  );

  const run = useCallback(async <T>(call: () => Promise<ApiResponse<T>>): Promise<T | null> => {
    setPending(true);
    setError(null);
    try {
      const res = await call();
      if (res.success) return res.data;
      setError(res);
      return null;
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, error, setError, fieldErrors: fieldErrors(error), validate, run };
}
