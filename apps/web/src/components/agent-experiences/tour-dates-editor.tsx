'use client';

import {
  EXPERIENCE_LIMITS,
  replaceTourDatesSchema,
  type AgentExperienceView,
} from '@havenhub/shared';
import { Alert, Button, Input } from '@havenhub/ui';
import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { formatEventTime, fromLagosInput } from '@/lib/experiences';
import { useApiAction } from '@/lib/use-api-action';

import { Section } from './experience-form';

/**
 * When a tour runs. Dates are availability, not content: changing them keeps
 * a published tour live. Past dates are kept as history and not shown here.
 */
export function TourDatesEditor({
  experience,
  locked,
}: {
  experience: AgentExperienceView;
  locked: boolean;
}) {
  const router = useRouter();
  const { pending, error, run, setError } = useApiAction();
  const upcoming = (experience.tour?.dates ?? []).filter((d) => new Date(d) > new Date());
  const [dates, setDates] = useState<string[]>(upcoming);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);

  function add() {
    const iso = fromLagosInput(draft);
    if (!iso) return;
    const normal = new Date(iso).toISOString();
    if (new Date(normal) <= new Date()) {
      setError({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Choose a date in the future.',
      });
      return;
    }
    setError(null);
    setSaved(false);
    setDates((list) => [...new Set([...list, normal])].sort());
    setDraft('');
  }

  async function save() {
    const input = replaceTourDatesSchema.parse({ dates });
    const result = await run(() =>
      api<AgentExperienceView>('PUT', `/agents/me/experiences/${experience.id}/tour-dates`, input),
    );
    if (result) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <Section
      id="dates"
      title="Tour dates"
      description="Times are Nigerian time (WAT). Changing dates keeps a published tour live."
    >
      {dates.length === 0 ? (
        <p className="text-sm text-text-secondary">No upcoming dates.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {dates.map((d) => (
            <li
              key={d}
              className="flex items-center gap-1 rounded-full border border-border py-1 pr-1 pl-3 text-sm text-text"
            >
              {formatEventTime(d)}
              {!locked && (
                <button
                  type="button"
                  aria-label={`Remove ${formatEventTime(d)}`}
                  onClick={() => {
                    setSaved(false);
                    setDates((list) => list.filter((x) => x !== d));
                  }}
                  className="grid size-6 place-items-center rounded-full hover:bg-surface-secondary"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!locked && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-text">
              Add a date and start time
              <Input
                type="datetime-local"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    add();
                  }
                }}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              onClick={add}
              disabled={!draft || dates.length >= EXPERIENCE_LIMITS.tourDates}
            >
              <Plus aria-hidden className="size-4" /> Add
            </Button>
          </div>
          {error && <Alert tone="error">{error.message}</Alert>}
          {saved && <Alert tone="success">Dates saved.</Alert>}
          <div className="flex justify-end">
            <Button type="button" onClick={save} loading={pending}>
              Save dates
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}
