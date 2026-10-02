import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { ErrorCode } from '@havenhub/shared';
import type { z } from 'zod';

import { AppException } from '../errors/app.exception';

export interface FieldIssue {
  path: string;
  message: string;
}

/**
 * Validates and normalises a request body/query with a shared Zod schema.
 * Unknown keys are stripped, so clients can never smuggle extra fields
 * (e.g. `accountType`, `roles`) into a handler.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;

    const issues: FieldIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.VALIDATION_ERROR,
      'Please check the highlighted fields.',
      { issues },
    );
  }
}

/** Shorthand: `@Body(validate(schema)) body: z.output<typeof schema>` */
export const validate = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema);
