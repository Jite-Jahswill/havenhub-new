import { z } from 'zod';

/**
 * Every API error uses this envelope so web and mobile clients can handle
 * failures uniformly. `code` is a stable machine-readable identifier;
 * `message` is safe to show to end users.
 */
export const apiErrorSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiSuccessSchema = <T extends z.ZodType>(data: T) =>
  z.object({
    success: z.literal(true),
    data,
  });

export type ApiSuccess<T> = { success: true; data: T };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;
