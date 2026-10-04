import { AppException } from '../errors/app.exception';

export interface ErrorFields {
  errorName: string;
  errorCode?: string;
  /** Omitted for errors whose message can carry data (database, SMTP). */
  errorMessage?: string;
}

/**
 * What may be logged about an error. Prisma messages can quote query values
 * and SMTP replies can quote addresses, so for those only the class and code
 * are kept; our own errors keep their (bounded) message.
 */
export function describeError(error: unknown): ErrorFields {
  if (!(error instanceof Error)) return { errorName: typeof error };
  const name = error.constructor?.name || error.name || 'Error';
  const code = (error as { code?: unknown }).code;
  const fields: ErrorFields = { errorName: name };
  if (typeof code === 'string' || typeof code === 'number') fields.errorCode = String(code);
  if (error instanceof AppException) fields.errorCode = error.code;
  const sensitive =
    name.startsWith('PrismaClient') ||
    name === 'SmtpSendError' ||
    (typeof code === 'string' && /^E[A-Z]+$/.test(code));
  if (!sensitive) fields.errorMessage = error.message.slice(0, 300);
  return fields;
}

/** A stack trace without its first line (which repeats the possibly-sensitive message). */
export const framesOf = (error: unknown): string | undefined =>
  error instanceof Error && error.stack
    ? error.stack
        .split('\n')
        .filter((line) => line.trimStart().startsWith('at '))
        .join('\n')
    : undefined;
