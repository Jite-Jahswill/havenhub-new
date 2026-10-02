import type { Paginated } from '@havenhub/shared';
import { buttonClasses } from '@havenhub/ui';
import Link from 'next/link';

export function Pagination({
  page,
  basePath,
  params,
}: {
  page: Pick<Paginated<unknown>, 'page' | 'totalPages' | 'total'>;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (page.totalPages <= 1) return null;
  const href = (target: number) => {
    const search = new URLSearchParams(
      Object.entries({ ...params, page: String(target) }).filter((e): e is [string, string] =>
        Boolean(e[1]),
      ),
    );
    return `${basePath}?${search}`;
  };
  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex items-center justify-between text-sm text-text-secondary"
    >
      <span>
        Page {page.page} of {page.totalPages} · {page.total} total
      </span>
      <div className="flex gap-2">
        {page.page > 1 && (
          <Link
            href={href(page.page - 1)}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            Previous
          </Link>
        )}
        {page.page < page.totalPages && (
          <Link
            href={href(page.page + 1)}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}
