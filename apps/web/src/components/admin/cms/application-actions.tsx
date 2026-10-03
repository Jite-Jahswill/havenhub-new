'use client';

import { APPLICATION_STATUS_LABELS, type AdminApplicationView } from '@havenhub/shared';
import { Alert, Button } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';

/** Moves an application through New → Reviewed → Shortlisted → Hired/Rejected, or deletes it. */
export function ApplicationActions({ application }: { application: AdminApplicationView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, fn: () => ReturnType<typeof api>) {
    setBusy(key);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (!res.success) setError(res.message);
    return res.success;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      {application.nextStatuses.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {application.nextStatuses.map((s) => (
            <Button
              key={s}
              variant={s === 'REJECTED' ? 'ghost' : 'secondary'}
              loading={busy === s}
              onClick={async () => {
                if (
                  await run(s, () =>
                    api('PATCH', `/admin/careers/applications/${application.id}`, { status: s }),
                  )
                )
                  router.refresh();
              }}
            >
              Mark {APPLICATION_STATUS_LABELS[s].toLowerCase()}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          This application is closed ({APPLICATION_STATUS_LABELS[application.status].toLowerCase()}
          ).
        </p>
      )}
      <Button
        variant="danger"
        className="self-start"
        loading={busy === 'delete'}
        onClick={async () => {
          if (!window.confirm('Delete this application and its CV permanently?')) return;
          if (
            await run('delete', () =>
              api('DELETE', `/admin/careers/applications/${application.id}`),
            )
          )
            router.push('/admin/careers/applications');
        }}
      >
        Delete application
      </Button>
    </div>
  );
}
