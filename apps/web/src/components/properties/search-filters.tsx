'use client';

import { PropertyType, nairaToKobo, type AmenityView, type PricingPeriod } from '@havenhub/shared';
import { Button, Field, Input, Select, cn } from '@havenhub/ui';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { AMENITY_CATEGORY_LABELS, PROPERTY_TYPE_LABELS } from '@/lib/labels';

export type SearchState = Record<string, string | undefined>;

const PERIOD_OPTIONS: [PricingPeriod, string][] = [
  ['DAILY', 'Short stays'],
  ['MONTHLY', 'Monthly'],
  ['YEARLY', 'Yearly'],
];

/** Every filter writes to the URL, so results are shareable and survive refreshes. */
export function SearchFilters({
  state,
  amenities,
}: {
  state: SearchState;
  amenities: AmenityView[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState(state.q ?? '');

  function apply(patch: SearchState) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...state, ...patch, page: undefined })) {
      if (value) next.set(key, value);
    }
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const isSale = state.listingType === 'SALE';
  const moreCount = [
    'minPrice',
    'maxPrice',
    'minBedrooms',
    'minBathrooms',
    'minGuests',
    'amenities',
    'furnished',
    'cleaningIncluded',
  ].filter((key) => state[key]).length;

  function submitMore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' && value ? value : undefined;
    };
    const naira = (name: string) => {
      const value = Number(text(name));
      return Number.isFinite(value) && value > 0 ? String(nairaToKobo(value)) : undefined;
    };
    apply({
      minPrice: naira('minPrice'),
      maxPrice: naira('maxPrice'),
      minBedrooms: text('minBedrooms'),
      minBathrooms: text('minBathrooms'),
      minGuests: text('minGuests'),
      amenities:
        form
          .getAll('amenities')
          .filter((v): v is string => typeof v === 'string')
          .join(',') || undefined,
      furnished: form.get('furnished') ? 'true' : undefined,
      cleaningIncluded: form.get('cleaningIncluded') ? 'true' : undefined,
    });
    dialog.current?.close();
  }

  const toNaira = (kobo: string | undefined) => (kobo ? String(Number(kobo) / 100) : '');
  const selectedAmenities = new Set(state.amenities?.split(',') ?? []);
  const grouped = Object.entries(AMENITY_CATEGORY_LABELS).map(([category, label]) => ({
    label,
    items: amenities.filter((a) => a.category === category),
  }));

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          apply({ q: q.trim() || undefined });
        }}
        className="relative"
      >
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-text-muted"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by area, city or street"
          aria-label="Search properties"
          className="h-12 rounded-full pr-28 pl-11"
        />
        <Button
          type="submit"
          size="sm"
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-full"
        >
          Search
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Rent or buy"
          className="flex rounded-full border border-border bg-surface p-0.5"
        >
          {[
            [undefined, 'All'],
            ['RENT', 'Rent'],
            ['SALE', 'Buy'],
          ].map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={state.listingType === value}
              onClick={() =>
                apply({
                  listingType: value,
                  pricingPeriod: value === 'SALE' ? undefined : state.pricingPeriod,
                })
              }
              className={cn(
                'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                state.listingType === value
                  ? 'bg-surface-inverse text-text-inverse'
                  : 'text-text-secondary hover:text-text',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {!isSale && (
          <Select
            aria-label="Rental period"
            value={state.pricingPeriod ?? ''}
            onChange={(e) =>
              apply({
                pricingPeriod: e.target.value || undefined,
                listingType: e.target.value ? 'RENT' : state.listingType,
              })
            }
            className="h-10 w-auto rounded-full"
          >
            <option value="">Any period</option>
            {PERIOD_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}

        <Select
          aria-label="Property type"
          value={state.propertyType ?? ''}
          onChange={(e) => apply({ propertyType: e.target.value || undefined })}
          className="h-10 w-auto rounded-full"
        >
          <option value="">Any type</option>
          {Object.values(PropertyType).map((type) => (
            <option key={type} value={type}>
              {PROPERTY_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>

        <Button
          variant="secondary"
          size="sm"
          className="h-10 rounded-full"
          onClick={() => dialog.current?.showModal()}
        >
          <SlidersHorizontal aria-hidden className="size-4" />
          Filters
          {moreCount > 0 && (
            <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground">
              {moreCount}
            </span>
          )}
        </Button>

        {Object.entries(state).some(([key, value]) => value && !['page', 'sort'].includes(key)) && (
          <button
            type="button"
            onClick={() => router.push(pathname, { scroll: false })}
            className="px-2 text-sm font-medium text-text-secondary underline-offset-4 hover:text-text hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <dialog
        ref={dialog}
        aria-labelledby="filters-title"
        className="m-auto w-[min(640px,calc(100vw-2rem))] rounded-card border border-border bg-surface p-0 text-text shadow-overlay backdrop:bg-black/40"
      >
        <form onSubmit={submitMore} className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 id="filters-title" className="text-lg font-semibold">
              Filters
            </h2>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              aria-label="Close filters"
              className="grid size-9 place-items-center rounded-full hover:bg-surface-secondary"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>

          <div className="flex flex-col gap-7 overflow-y-auto px-6 py-6">
            <fieldset className="grid grid-cols-2 gap-4">
              <legend className="mb-3 font-semibold">Price range (₦)</legend>
              <Field label="Minimum">
                {(a) => (
                  <Input
                    {...a}
                    name="minPrice"
                    inputMode="numeric"
                    defaultValue={toNaira(state.minPrice)}
                    placeholder="No min"
                  />
                )}
              </Field>
              <Field label="Maximum">
                {(a) => (
                  <Input
                    {...a}
                    name="maxPrice"
                    inputMode="numeric"
                    defaultValue={toNaira(state.maxPrice)}
                    placeholder="No max"
                  />
                )}
              </Field>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ['minBedrooms', 'Bedrooms'],
                  ['minBathrooms', 'Bathrooms'],
                  ...(state.pricingPeriod === 'DAILY' ? [['minGuests', 'Guests'] as const] : []),
                ] as const
              ).map(([name, label]) => (
                <Field key={name} label={label}>
                  {(a) => (
                    <Select {...a} name={name} defaultValue={state[name] ?? ''}>
                      <option value="">Any</option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}+
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ))}
            </div>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 font-semibold">Good to have</legend>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="furnished"
                  defaultChecked={Boolean(state.furnished)}
                  className="size-4 accent-primary"
                />
                Furnished
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="cleaningIncluded"
                  defaultChecked={Boolean(state.cleaningIncluded)}
                  className="size-4 accent-primary"
                />
                Cleaning included
              </label>
            </fieldset>

            {grouped.map(
              (group) =>
                group.items.length > 0 && (
                  <fieldset key={group.label}>
                    <legend className="mb-3 font-semibold">{group.label}</legend>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                      {group.items.map((amenity) => (
                        <label key={amenity.id} className="flex items-center gap-3 text-sm">
                          <input
                            type="checkbox"
                            name="amenities"
                            value={amenity.slug}
                            defaultChecked={selectedAmenities.has(amenity.slug)}
                            className="size-4 accent-primary"
                          />
                          {amenity.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ),
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <Button
              variant="ghost"
              onClick={() => {
                apply({
                  minPrice: undefined,
                  maxPrice: undefined,
                  minBedrooms: undefined,
                  minBathrooms: undefined,
                  minGuests: undefined,
                  amenities: undefined,
                  furnished: undefined,
                  cleaningIncluded: undefined,
                });
                dialog.current?.close();
              }}
            >
              Reset
            </Button>
            <Button type="submit">Show results</Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
