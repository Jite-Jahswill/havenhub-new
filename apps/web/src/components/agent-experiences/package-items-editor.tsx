'use client';

import {
  EXPERIENCE_LIMITS,
  PACKAGE_ITEM_CATEGORY_LABELS,
  PackageItemCategory,
  formatKobo,
  nairaToKobo,
  replacePackageItemsSchema,
  type AgentExperienceView,
  type PackageItemView,
} from '@havenhub/shared';
import { Alert, Button, Input, Select } from '@havenhub/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

import { Section } from './experience-form';

interface Row {
  key: string;
  category: PackageItemCategory;
  name: string;
  description: string;
  price: string;
  perPerson: boolean;
}

const toRow = (i: PackageItemView): Row => ({
  key: i.id,
  category: i.category,
  name: i.name,
  description: i.description ?? '',
  price: String(i.priceKobo / 100),
  perPerson: i.perPerson,
});
let next = 0;

const HINT: Record<'TOUR' | 'EVENT' | 'HOTEL' | 'CLEANING', string> = {
  CLEANING:
    'Customers pick a day you work, give their address and pay your price per visit. Add extras they can pay for, like deep-cleaning the kitchen or ironing.',
  TOUR: 'Add the tour fee, food, a place to stay, transport… Each is priced per day. Guests take the full package or pick what they want.',
  EVENT:
    'Tickets are charged per person per day. Add extras guests can pay for too, like food, a place to stay or transport.',
  HOTEL:
    'Rooms are charged per night from your room types. Add extras guests can pay for, like meals or an airport pickup.',
};

/**
 * Online booking for a tour, event, hotel or cleaning service: the switch,
 * and the package items guests can pay for, each priced per day (per person
 * when set).
 */
export function PackageItemsEditor({
  experience,
  locked,
}: {
  experience: AgentExperienceView;
  locked: boolean;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [rows, setRows] = useState<Row[]>(() => experience.packageItems.map(toRow));
  const [online, setOnline] = useState(experience.onlineBooking);
  const [saved, setSaved] = useState(false);
  const kind = experience.kind;
  const published = experience.status === 'PUBLISHED';

  const update = (key: string, patch: Partial<Row>) => {
    setSaved(false);
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  async function save() {
    const input = validate(replacePackageItemsSchema, {
      items: rows.map((r) => ({
        category: r.category,
        name: r.name.trim(),
        description: r.description.trim() || null,
        priceKobo: r.price.trim() === '' ? NaN : nairaToKobo(Number(r.price.replace(/,/g, ''))),
        perPerson: r.perPerson,
      })),
    });
    if (!input) return;
    let result = await run(() =>
      api<AgentExperienceView>(
        'PUT',
        `/agents/me/experiences/${experience.id}/package-items`,
        input,
      ),
    );
    if (result && result.onlineBooking !== online) {
      result = await run(() =>
        api<AgentExperienceView>('PATCH', `/agents/me/experiences/${experience.id}`, {
          onlineBooking: online,
        }),
      );
    }
    if (result) {
      setSaved(true);
      setRows(result.packageItems.map(toRow));
      setOnline(result.onlineBooking);
      router.refresh();
    }
  }

  const rowError = (index: number, field: string) => fieldErrors[`items.${index}.${field}`];

  return (
    <Section id="booking" title="Online booking" description={HINT[kind]}>
      {locked ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            Online booking is{' '}
            <span className="font-semibold">{experience.onlineBooking ? 'on' : 'off'}</span>.
          </p>
          {experience.packageItems.length ? (
            <ul className="flex flex-col gap-2">
              {experience.packageItems.map((i) => (
                <li key={i.id} className="flex justify-between gap-3">
                  <span>
                    {i.name}{' '}
                    <span className="text-text-muted">
                      ({PACKAGE_ITEM_CATEGORY_LABELS[i.category]})
                    </span>
                  </span>
                  <span className="font-medium">
                    {formatKobo(i.priceKobo)} {i.perPerson ? 'per person a day' : 'a day'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-secondary">No package items.</p>
          )}
        </div>
      ) : (
        <>
          <label className="flex items-start gap-3 rounded-control border border-border p-4 text-sm text-text">
            <input
              type="checkbox"
              checked={online}
              onChange={(e) => {
                setSaved(false);
                setOnline(e.target.checked);
              }}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="font-semibold">Accept online bookings and payment</span>
              <span className="block text-text-secondary">
                Guests book and pay with Paystack on HavenHub. You receive your share after
                HavenHub’s commission, like rentals.
              </span>
            </span>
          </label>

          {rows.length === 0 && (
            <p className="text-sm text-text-secondary">
              {kind === 'TOUR'
                ? 'No items yet. A tour needs at least one item (such as the tour fee) to be booked.'
                : 'No extras yet.'}
            </p>
          )}
          <ul className="flex flex-col gap-4">
            {rows.map((row, index) => (
              <li key={row.key} className="rounded-control border border-border p-4">
                <div className="grid gap-3 sm:grid-cols-[170px_minmax(0,1fr)_140px_auto] sm:items-start">
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
                    Covers
                    <Select
                      value={row.category}
                      onChange={(e) =>
                        update(row.key, { category: e.target.value as PackageItemCategory })
                      }
                    >
                      {Object.values(PackageItemCategory).map((c) => (
                        <option key={c} value={c}>
                          {PACKAGE_ITEM_CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
                    Name
                    <Input
                      value={row.name}
                      maxLength={80}
                      aria-invalid={rowError(index, 'name') ? true : undefined}
                      onChange={(e) => update(row.key, { name: e.target.value })}
                      placeholder="e.g. Lunch and drinks"
                    />
                    {rowError(index, 'name') && (
                      <span className="text-xs text-error">{rowError(index, 'name')}</span>
                    )}
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
                    Price a day (₦)
                    <Input
                      value={row.price}
                      inputMode="decimal"
                      aria-invalid={rowError(index, 'priceKobo') ? true : undefined}
                      onChange={(e) => update(row.key, { price: e.target.value })}
                      placeholder="e.g. 15000"
                    />
                    {rowError(index, 'priceKobo') && (
                      <span className="text-xs text-error">Enter a price</span>
                    )}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove ${row.name || 'item'}`}
                    className="self-end"
                    onClick={() => {
                      setSaved(false);
                      setRows((list) => list.filter((r) => r.key !== row.key));
                    }}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
                    <span>
                      Description <span className="font-normal text-text-muted">(optional)</span>
                    </span>
                    <Input
                      value={row.description}
                      maxLength={300}
                      onChange={(e) => update(row.key, { description: e.target.value })}
                      placeholder="What’s included"
                    />
                  </label>
                  <label className="flex items-center gap-2 pb-2.5 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={row.perPerson}
                      onChange={(e) => update(row.key, { perPerson: e.target.checked })}
                      className="size-4 accent-primary"
                    />
                    Per person
                  </label>
                </div>
              </li>
            ))}
          </ul>
          {fieldErrors.items && <p className="text-sm text-error">{fieldErrors.items}</p>}
          {fieldErrors.onlineBooking && (
            <p className="text-sm text-error">{fieldErrors.onlineBooking}</p>
          )}
          {error && error.code !== 'VALIDATION_ERROR' && (
            <Alert tone="error">{error.message}</Alert>
          )}
          {saved && (
            <Alert tone="success">
              {published ? 'Saved. The listing has been sent for review.' : 'Online booking saved.'}
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={rows.length >= EXPERIENCE_LIMITS.packageItems}
              onClick={() =>
                setRows((list) => [
                  ...list,
                  {
                    key: `new-${++next}`,
                    category: kind === 'TOUR' && list.length === 0 ? 'TOUR_FEE' : 'FOOD',
                    name: '',
                    description: '',
                    price: '',
                    perPerson: true,
                  },
                ])
              }
            >
              <Plus aria-hidden className="size-4" /> Add item
            </Button>
            <Button type="button" onClick={save} loading={pending}>
              Save online booking
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}
