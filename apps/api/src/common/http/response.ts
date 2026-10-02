import type { ApiSuccess, Paginated } from '@havenhub/shared';

/** Wraps a payload in the shared success envelope. */
export const ok = <T>(data: T): ApiSuccess<T> => ({ success: true, data });

export const toIso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
  total: number,
): Paginated<T> {
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
