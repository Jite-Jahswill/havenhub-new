'use client';

import {
  EXPERIENCE_KIND_LABELS,
  EXPERIENCE_LIMITS,
  type AdminVacationZoneView,
  type ExperienceKind,
  type ExperienceSearchResult,
} from '@havenhub/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Select,
  Spinner,
} from '@havenhub/ui';
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { Photo } from '@/components/properties/photo';
import { api, apiUpload } from '@/lib/api/client';
import { formText } from '@/lib/form';

export function ZoneCover({ zone }: { zone: AdminVacationZoneView }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    const res = await apiUpload(`/admin/vacation-zones/${zone.id}/cover`, file);
    setBusy(false);
    if (!res.success) setError(res.message);
    if (input.current) input.current.value = '';
    router.refresh();
  }

  return (
    <Card>
      <CardHeader title="Cover photo" />
      <CardBody className="flex flex-col gap-4">
        <div className="relative aspect-[16/9] overflow-hidden rounded-control bg-surface-secondary">
          {zone.coverImage ? (
            <Photo src={zone.coverImage.url} alt={zone.name} sizes="400px" />
          ) : (
            <p className="grid size-full place-items-center text-sm text-text-muted">
              No cover photo
            </p>
          )}
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <Button variant="secondary" onClick={() => input.current?.click()} loading={busy}>
          <ImagePlus aria-hidden className="size-4" />{' '}
          {zone.coverImage ? 'Replace photo' : 'Upload photo'}
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          aria-label="Upload cover photo"
          tabIndex={-1}
          onChange={(e) => void upload(e.target.files)}
        />
      </CardBody>
    </Card>
  );
}

type Item = { id: string; title: string; kind: ExperienceKind; public: boolean };

/** Published tours and hotels shown on the destination, in order. */
export function ZoneCuration({ zone }: { zone: AdminVacationZoneView }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(zone.experiences);
  const [results, setResults] = useState<ExperienceSearchResult['items'] | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = formText(form, 'kind') || 'TOUR';
    const q = formText(form, 'q').slice(0, 100);
    setSearching(true);
    const params = new URLSearchParams({ kind, pageSize: '12', ...(q ? { q } : {}) });
    const res = await api<ExperienceSearchResult>('GET', `/experiences?${params}`);
    setSearching(false);
    setResults(res.success ? res.data.items : []);
    if (!res.success) setMessage({ tone: 'error', text: res.message });
  }

  function move(index: number, delta: number) {
    setItems((list) => {
      const copy = [...list];
      const [moved] = copy.splice(index, 1);
      copy.splice(index + delta, 0, moved!);
      return copy;
    });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const res = await api('PUT', `/admin/vacation-zones/${zone.id}/experiences`, {
      experienceIds: items.map((i) => i.id),
    });
    setSaving(false);
    setMessage(
      res.success ? { tone: 'success', text: 'Saved.' } : { tone: 'error', text: res.message },
    );
    if (res.success) router.refresh();
  }

  const chosen = new Set(items.map((i) => i.id));
  return (
    <Card>
      <CardHeader
        title="Featured tours & hotels"
        description="Only published listings can be featured. Listings that later go private are hidden automatically."
      />
      <CardBody className="flex flex-col gap-5">
        {items.length === 0 ? (
          <p className="text-sm text-text-secondary">Nothing featured yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {items.map((item, index) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {item.title}{' '}
                  <span className="text-text-muted">· {EXPERIENCE_KIND_LABELS[item.kind].one}</span>
                </span>
                {!item.public && <Badge tone="warning">Hidden</Badge>}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${item.title} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${item.title} down`}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${item.title}`}
                  onClick={() => setItems((list) => list.filter((i) => i.id !== item.id))}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </li>
            ))}
          </ol>
        )}

        <form
          role="search"
          onSubmit={(e) => void search(e)}
          className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row"
        >
          <Select name="kind" aria-label="Listing type" className="sm:w-36" defaultValue="TOUR">
            <option value="TOUR">Tours</option>
            <option value="HOTEL">Hotels</option>
          </Select>
          <Input
            name="q"
            maxLength={100}
            placeholder="Search published listings"
            aria-label="Search"
          />
          <Button type="submit" variant="secondary" loading={searching}>
            Search
          </Button>
        </form>
        {searching && !results && <Spinner />}
        {results && (
          <ul className="flex flex-col gap-2">
            {results.length === 0 && (
              <li className="text-sm text-text-secondary">No published listings found.</li>
            )}
            {results.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {r.title}{' '}
                  <span className="text-text-muted">
                    · {[r.city, r.state].filter(Boolean).join(', ')}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={chosen.has(r.id) || items.length >= EXPERIENCE_LIMITS.zoneExperiences}
                  onClick={() =>
                    setItems((list) => [
                      ...list,
                      { id: r.id, title: r.title, kind: r.kind, public: true },
                    ])
                  }
                >
                  {chosen.has(r.id) ? 'Added' : 'Add'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <div className="flex justify-end">
          <Button onClick={() => void save()} loading={saving}>
            Save featured listings
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function DeleteZone({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {error && <Alert tone="error">{error}</Alert>}
      <Button
        variant="ghost"
        loading={busy}
        onClick={async () => {
          if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return;
          setBusy(true);
          const res = await api('DELETE', `/admin/vacation-zones/${id}`);
          setBusy(false);
          if (res.success) router.push('/admin/destinations');
          else setError(res.message);
        }}
      >
        <Trash2 aria-hidden className="size-4" /> Delete destination
      </Button>
    </div>
  );
}
