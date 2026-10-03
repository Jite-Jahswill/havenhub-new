'use client';

import type { ApiError, ApiResponse } from '@havenhub/shared';
import { Alert, Button, Card, CardBody, CardHeader, Input } from '@havenhub/ui';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';

import type { TaxonomyRow as Row } from './taxonomy-rows';

/** Categories or tags: add, rename (categories), delete when unused. */
export function TaxonomyManager({
  title,
  description,
  rows,
  endpoint,
  countLabel,
  renamable,
}: {
  title: string;
  description?: string;
  rows: Row[];
  endpoint: string;
  countLabel: string;
  renamable: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  async function run(key: string, fn: () => Promise<ApiResponse<unknown>>) {
    setBusy(key);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (!res.success) setError(res);
    router.refresh();
    return res.success;
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run('add', () => api('POST', endpoint, { name }))) setName('');
  }

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="flex flex-col gap-4">
        {error && <Alert tone="error">{error.message}</Alert>}
        {rows.length === 0 ? (
          <p className="text-sm text-text-secondary">None yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-control border border-border">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                {editing?.id === r.id ? (
                  <form
                    className="flex flex-1 gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (
                        await run(`rename-${r.id}`, () =>
                          api('PATCH', `${endpoint}/${r.id}`, { name: editing.name }),
                        )
                      )
                        setEditing(null);
                    }}
                  >
                    <Input
                      aria-label="Name"
                      value={editing.name}
                      onChange={(e) => setEditing({ id: r.id, name: e.target.value })}
                      maxLength={80}
                    />
                    <Button type="submit" size="sm" loading={busy === `rename-${r.id}`}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-text">{r.name}</span>{' '}
                      <span className="text-xs text-text-muted">
                        /{r.slug} · {r.count} {countLabel}
                      </span>
                    </span>
                    {renamable && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing({ id: r.id, name: r.name })}
                      >
                        Rename
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${r.name}`}
                      disabled={r.count > 0}
                      title={r.count > 0 ? 'In use' : undefined}
                      loading={busy === `del-${r.id}`}
                      onClick={() => {
                        if (window.confirm(`Delete “${r.name}”?`))
                          void run(`del-${r.id}`, () => api('DELETE', `${endpoint}/${r.id}`));
                      }}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={(e) => void add(e)} className="flex gap-2">
          <Input
            aria-label={`New ${title.toLowerCase()} name`}
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
          <Button
            type="submit"
            variant="secondary"
            loading={busy === 'add'}
            disabled={name.trim().length < 2}
          >
            Add
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
