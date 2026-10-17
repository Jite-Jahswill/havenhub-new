import type { PropertyReviewsPage } from '@havenhub/shared';
import Link from 'next/link';

import { Rating, Stars } from '@/components/properties/rating';

const REVIEW_DATE = new Intl.DateTimeFormat('en-NG', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Africa/Lagos',
});

/** Published reviews of a listing, with paging through `?reviews=`. */
export function ReviewsList({ reviews, note }: { reviews: PropertyReviewsPage; note: string }) {
  return (
    <div id="reviews" className="flex flex-col gap-6">
      <Rating rating={reviews.rating} long className="text-base" />
      <ul className="flex flex-col gap-6">
        {reviews.items.map((r) => (
          <li key={r.id} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <Stars value={r.rating} />
              <span className="text-sm font-semibold text-text">{r.authorName}</span>
              <span className="text-xs text-text-muted">
                {REVIEW_DATE.format(new Date(r.createdAt))}
              </span>
            </div>
            {r.comment && (
              <p className="text-sm leading-relaxed whitespace-pre-line text-text-secondary">
                {r.comment}
              </p>
            )}
          </li>
        ))}
      </ul>
      {reviews.totalPages > 1 && (
        <nav aria-label="More reviews" className="flex gap-4 text-sm">
          {reviews.page > 1 && (
            <Link href={`?reviews=${reviews.page - 1}#reviews`} className="underline">
              Newer reviews
            </Link>
          )}
          {reviews.page < reviews.totalPages && (
            <Link href={`?reviews=${reviews.page + 1}#reviews`} className="underline">
              Older reviews
            </Link>
          )}
        </nav>
      )}
      <p className="text-xs text-text-muted">{note}</p>
    </div>
  );
}
