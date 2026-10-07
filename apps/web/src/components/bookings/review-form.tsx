'use client';

import { createReviewSchema, type BookingReviewState } from '@havenhub/shared';
import { Alert, Button, Field, Textarea, cn } from '@havenhub/ui';
import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

const LABELS = ['Terrible', 'Poor', 'Okay', 'Good', 'Excellent'];

/** The customer rates their completed stay (once). */
export function ReviewForm({
  bookingId,
  reviewBy,
}: {
  bookingId: string;
  reviewBy: string | null;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = validate(createReviewSchema, { rating, comment });
    if (!input) return;
    if (await run(() => api<BookingReviewState>('POST', `/bookings/${bookingId}/review`, input))) {
      router.refresh();
    }
  }

  const shown = hover || rating;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-text">Your rating</legend>
        <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer" onMouseEnter={() => setHover(n)}>
              <input
                type="radio"
                name="rating"
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                className="sr-only"
              />
              <Star
                aria-hidden
                className={cn(
                  'size-8 transition-colors',
                  n <= shown ? 'fill-amber-400 text-amber-400' : 'text-border-strong',
                )}
              />
              <span className="sr-only">
                {n} {n === 1 ? 'star' : 'stars'} ({LABELS[n - 1]})
              </span>
            </label>
          ))}
          <span className="ml-2 text-sm text-text-secondary" aria-live="polite">
            {shown ? LABELS[shown - 1] : ''}
          </span>
        </div>
        {fieldErrors.rating && <p className="mt-1 text-sm text-error">{fieldErrors.rating}</p>}
      </fieldset>
      <Field label="Tell other guests about it" optional error={fieldErrors.comment}>
        {(a) => (
          <Textarea
            {...a}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            maxLength={2000}
          />
        )}
      </Field>
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          Post review
        </Button>
        {reviewBy && (
          <span className="text-xs text-text-muted">
            You can review until{' '}
            {new Date(reviewBy).toLocaleDateString('en-NG', {
              day: 'numeric',
              month: 'long',
              timeZone: 'Africa/Lagos',
            })}
            . Reviews are public and cannot be edited.
          </span>
        )}
      </div>
    </form>
  );
}
