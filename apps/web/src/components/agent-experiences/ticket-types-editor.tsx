'use client';

import {
  EXPERIENCE_LIMITS,
  TICKET_TYPE_LABELS,
  TicketTypeKind,
  formatKobo,
  nairaToKobo,
  replaceTicketTypesSchema,
  type AgentExperienceView,
  type TicketTypeView,
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
  kind: TicketTypeKind;
  name: string;
  description: string;
  price: string;
}

const toRow = (t: TicketTypeView): Row => ({
  key: t.id,
  kind: t.kind,
  name: t.name,
  description: t.description ?? '',
  price: String(t.priceKobo / 100),
});
let next = 0;

/**
 * An event's ticket types and listed prices. These describe what the
 * organiser offers; HavenHub does not sell tickets yet.
 */
export function TicketTypesEditor({
  experience,
  locked,
}: {
  experience: AgentExperienceView;
  locked: boolean;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const initial = experience.event?.ticketTypes ?? [];
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const [saved, setSaved] = useState(false);
  const published = experience.status === 'PUBLISHED';

  const update = (key: string, patch: Partial<Row>) => {
    setSaved(false);
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  async function save() {
    const input = validate(replaceTicketTypesSchema, {
      ticketTypes: rows.map((r) => ({
        kind: r.kind,
        name: r.name.trim(),
        description: r.description.trim() || null,
        priceKobo: r.price.trim() === '' ? NaN : nairaToKobo(Number(r.price.replace(/,/g, ''))),
      })),
    });
    if (!input) return;
    const result = await run(() =>
      api<AgentExperienceView>(
        'PUT',
        `/agents/me/experiences/${experience.id}/ticket-types`,
        input,
      ),
    );
    if (result) {
      setSaved(true);
      setRows((result.event?.ticketTypes ?? []).map(toRow));
      router.refresh();
    }
  }

  const rowError = (index: number, field: string) => fieldErrors[`ticketTypes.${index}.${field}`];

  return (
    <Section
      id="tickets"
      title="Ticket types"
      description="What you offer and the listed price of each. Ticket sales on HavenHub are coming later."
    >
      {locked ? (
        initial.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {initial.map((t) => (
              <li key={t.id} className="flex justify-between gap-3">
                <span>
                  {t.name} <span className="text-text-muted">({TICKET_TYPE_LABELS[t.kind]})</span>
                </span>
                <span className="font-medium">{formatKobo(t.priceKobo)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-secondary">No ticket types.</p>
        )
      ) : (
        <>
          {rows.length === 0 && (
            <p className="text-sm text-text-secondary">
              No ticket types yet. Add Regular, VIP and others.
            </p>
          )}
          <ul className="flex flex-col gap-4">
            {rows.map((row, index) => (
              <li key={row.key} className="rounded-control border border-border p-4">
                <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_140px_auto] sm:items-start">
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
                    Type
                    <Select
                      value={row.kind}
                      onChange={(e) => update(row.key, { kind: e.target.value as TicketTypeKind })}
                    >
                      {Object.values(TicketTypeKind).map((k) => (
                        <option key={k} value={k}>
                          {TICKET_TYPE_LABELS[k]}
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
                      placeholder="e.g. Early Bird"
                    />
                    {rowError(index, 'name') && (
                      <span className="text-xs text-error">{rowError(index, 'name')}</span>
                    )}
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
                    Price (₦)
                    <Input
                      value={row.price}
                      inputMode="decimal"
                      aria-invalid={rowError(index, 'priceKobo') ? true : undefined}
                      onChange={(e) => update(row.key, { price: e.target.value })}
                      placeholder="0 for free"
                    />
                    {rowError(index, 'priceKobo') && (
                      <span className="text-xs text-error">Enter a price (0 for free)</span>
                    )}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove ${row.name || 'ticket type'}`}
                    className="self-end"
                    onClick={() => {
                      setSaved(false);
                      setRows((list) => list.filter((r) => r.key !== row.key));
                    }}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
                <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium text-text">
                  <span>
                    Description <span className="font-normal text-text-muted">(optional)</span>
                  </span>
                  <Input
                    value={row.description}
                    maxLength={500}
                    onChange={(e) => update(row.key, { description: e.target.value })}
                    placeholder="What’s included"
                  />
                </label>
              </li>
            ))}
          </ul>
          {fieldErrors.ticketTypes && (
            <p className="text-sm text-error">{fieldErrors.ticketTypes}</p>
          )}
          {error && error.code !== 'VALIDATION_ERROR' && (
            <Alert tone="error">{error.message}</Alert>
          )}
          {saved && (
            <Alert tone="success">
              {published ? 'Saved. The event has been sent for review.' : 'Ticket types saved.'}
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={rows.length >= EXPERIENCE_LIMITS.ticketTypes}
              onClick={() =>
                setRows((list) => [
                  ...list,
                  { key: `new-${++next}`, kind: 'REGULAR', name: '', description: '', price: '' },
                ])
              }
            >
              <Plus aria-hidden className="size-4" /> Add ticket type
            </Button>
            <Button type="button" onClick={save} loading={pending}>
              Save ticket types
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}
