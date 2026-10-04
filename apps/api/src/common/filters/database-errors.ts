import { Prisma } from '../../generated/prisma/client';

export type DatabaseErrorKind = 'conflict' | 'not_found' | 'retryable';

const CONFLICT_CODES = new Set(['23505', '23P01']); // unique, exclusion
const RETRYABLE_CODES = new Set(['40P01', '40001']); // deadlock, serialization failure

interface AdapterCause {
  originalCode?: string;
  kind?: string;
}

/**
 * Classifies the database errors that are expected under concurrency (the
 * shapes Prisma 7 with @prisma/adapter-pg actually produces):
 *  - P2002, or a raw query failing with 23505/23P01 → a conflicting record;
 *  - P2025 → the record was not found;
 *  - P2034, or a raw query failing with 40P01/40001 → safe to retry.
 * Everything else is unexpected and stays a 500.
 */
export function classifyDatabaseError(error: unknown): DatabaseErrorKind | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (error.code === 'P2002') return 'conflict';
  if (error.code === 'P2025') return 'not_found';
  if (error.code === 'P2034') return 'retryable';
  const cause = (error.meta as { driverAdapterError?: { cause?: AdapterCause } } | undefined)
    ?.driverAdapterError?.cause;
  const code = cause?.originalCode;
  if (code && CONFLICT_CODES.has(code)) return 'conflict';
  if ((code && RETRYABLE_CODES.has(code)) || cause?.kind === 'TransactionWriteConflict') {
    return 'retryable';
  }
  return null;
}

/** The Prisma/Postgres code, for logs (never values or messages, which may contain data). */
export function databaseErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const cause = (error.meta as { driverAdapterError?: { cause?: AdapterCause } } | undefined)
    ?.driverAdapterError?.cause;
  return cause?.originalCode ? `${error.code}/${cause.originalCode}` : error.code;
}
