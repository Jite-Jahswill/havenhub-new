'use client';

import { Input, cn } from '@havenhub/ui';
import { ExternalLink } from 'lucide-react';
import { useState, type ClipboardEvent } from 'react';

import { LocationMap } from './location-map';

export type Point = { lat: number | null; lng: number | null };

const LATLONG_URL = 'https://www.latlong.net/';

const parse = (text: string) => {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(value) ? value : null;
};

/** Roughly Nigeria. Outside it, the numbers are usually swapped or mistyped. */
const inNigeria = (lat: number, lng: number) => lat >= 4 && lat <= 14 && lng >= 2.6 && lng <= 14.7;

/**
 * Latitude/longitude typed in by the agent (copied from latlong.net), with
 * a how-to and a Google Maps preview of the result.
 */
export function CoordinatesField({
  value,
  onChange,
  disabled,
  error,
  mapClassName = 'h-64',
}: {
  value: Point;
  onChange: (point: Point) => void;
  disabled?: boolean;
  error?: string;
  mapClassName?: string;
}) {
  const [lat, setLat] = useState(value.lat?.toString() ?? '');
  const [lng, setLng] = useState(value.lng?.toString() ?? '');

  function update(nextLat: string, nextLng: string) {
    setLat(nextLat);
    setLng(nextLng);
    const a = parse(nextLat);
    const b = parse(nextLng);
    onChange(a !== null && b !== null ? { lat: a, lng: b } : { lat: null, lng: null });
  }

  // Pasting "6.4281, 3.4219" into either box fills both.
  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const parts = event.clipboardData
      .getData('text')
      .split(/[,\s]+/)
      .filter(Boolean);
    if (parts.length === 2 && parts.every((p) => parse(p) !== null)) {
      event.preventDefault();
      update(parts[0]!, parts[1]!);
    }
  }

  const pinned = value.lat !== null && value.lng !== null;
  const partial = !pinned && (lat.trim() !== '' || lng.trim() !== '');
  const outside = pinned && !inNigeria(value.lat!, value.lng!);

  return (
    <div className="flex flex-col gap-4">
      <details className="group rounded-control border border-border bg-surface-secondary px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-text">
          How to get the latitude and longitude from latlong.net
        </summary>
        <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-text-secondary">
          <li>
            Open{' '}
            <a
              href={LATLONG_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary-text underline"
            >
              latlong.net <ExternalLink aria-hidden className="size-3.5" />
            </a>{' '}
            in a new tab.
          </li>
          <li>
            In <span className="font-medium text-text">Place Name</span>, type the address with the
            area, city and state — for example “Admiralty Way, Lekki, Lagos, Nigeria” — then click{' '}
            <span className="font-medium text-text">Find</span>.
          </li>
          <li>
            If the marker isn’t exactly on the building, click the right spot on their map to move
            it.
          </li>
          <li>
            Copy the <span className="font-medium text-text">Latitude</span> and{' '}
            <span className="font-medium text-text">Longitude</span> numbers into the boxes below
            (you can paste “6.4281, 3.4219” into either box).
          </li>
          <li>Check the map preview shows the right place.</li>
        </ol>
        <p className="mt-3 text-xs text-text-muted">
          In Nigeria, latitude is between 4 and 14 and longitude between 3 and 15.
        </p>
      </details>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
          Latitude
          <Input
            value={lat}
            onChange={(e) => update(e.target.value, lng)}
            onPaste={onPaste}
            inputMode="decimal"
            placeholder="e.g. 6.428055"
            disabled={disabled}
            aria-invalid={error ? true : undefined}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
          Longitude
          <Input
            value={lng}
            onChange={(e) => update(lat, e.target.value)}
            onPaste={onPaste}
            inputMode="decimal"
            placeholder="e.g. 3.421944"
            disabled={disabled}
            aria-invalid={error ? true : undefined}
          />
        </label>
      </div>

      <div className={cn('overflow-hidden rounded-control border border-border', mapClassName)}>
        <LocationMap latitude={value.lat} longitude={value.lng} title="Location preview" />
      </div>

      <div className="flex items-center justify-between gap-3 text-xs">
        <p className={error || outside || partial ? 'text-error' : 'text-text-muted'}>
          {error ??
            (partial
              ? 'Enter both latitude and longitude as numbers.'
              : outside
                ? 'This point is outside Nigeria — check the numbers aren’t swapped.'
                : pinned
                  ? `Location set: ${value.lat!.toFixed(5)}, ${value.lng!.toFixed(5)}`
                  : 'No location set yet.')}
        </p>
        {(pinned || partial) && !disabled && (
          <button
            type="button"
            onClick={() => update('', '')}
            className="shrink-0 font-medium text-text-secondary underline"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
