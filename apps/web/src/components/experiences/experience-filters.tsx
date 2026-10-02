import { TOUR_CATEGORY_LABELS, type ExperienceKind } from '@havenhub/shared';
import { Button, Input, Select } from '@havenhub/ui';
import Link from 'next/link';

import { NIGERIAN_STATES } from '@/lib/labels';

export type ExperienceFilterState = Partial<
  Record<'q' | 'state' | 'category' | 'when' | 'sort' | 'page', string>
>;

/** A plain GET form: filters live in the URL, so results are shareable and work without JS. */
export function ExperienceFilters({
  kind,
  basePath,
  state,
}: {
  kind: ExperienceKind;
  basePath: string;
  state: ExperienceFilterState;
}) {
  const tab = (when: 'upcoming' | 'past') => {
    const params = new URLSearchParams(
      Object.entries({ ...state, when, page: undefined }).filter(
        (e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '',
      ),
    );
    if (when === 'upcoming') params.delete('when');
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  const past = state.when === 'past';
  return (
    <div className="flex flex-col gap-4">
      {kind === 'EVENT' && (
        <nav aria-label="Event dates" className="flex gap-2 text-sm">
          {(['upcoming', 'past'] as const).map((when) => (
            <Link
              key={when}
              href={tab(when)}
              aria-current={(when === 'past') === past ? 'page' : undefined}
              className="rounded-full border border-border px-3.5 py-1.5 font-medium text-text hover:bg-surface-secondary aria-[current=page]:bg-surface-inverse aria-[current=page]:text-text-inverse"
            >
              {when === 'upcoming' ? 'Upcoming' : 'Past events'}
            </Link>
          ))}
        </nav>
      )}
      <form
        role="search"
        action={basePath}
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap"
      >
        {past && <input type="hidden" name="when" value="past" />}
        <Input
          name="q"
          defaultValue={state.q}
          maxLength={100}
          placeholder="Search by name or place"
          aria-label="Search"
          className="sm:max-w-xs"
        />
        <Select
          name="state"
          defaultValue={state.state ?? ''}
          aria-label="State"
          className="sm:w-44"
        >
          <option value="">All states</option>
          {NIGERIAN_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        {kind === 'TOUR' && (
          <Select
            name="category"
            defaultValue={state.category ?? ''}
            aria-label="Category"
            className="sm:w-52"
          >
            <option value="">All categories</option>
            {Object.entries(TOUR_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}
        {kind === 'EVENT' && (
          <Select name="sort" defaultValue={state.sort ?? ''} aria-label="Sort" className="sm:w-44">
            <option value="">Newest</option>
            <option value="soonest">{past ? 'Most recent' : 'Soonest'}</option>
          </Select>
        )}
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
    </div>
  );
}
