'use client';

import { Button } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';

/** Join a support conversation (audited), then answer it in Messages. */
export function SupportJoin({ id, joined }: { id: string; joined: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (joined) {
    return (
      <Button size="sm" variant="secondary" onClick={() => router.push(`/admin/messages?c=${id}`)}>
        Open
      </Button>
    );
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          const res = await api('POST', `/admin/support/conversations/${id}/join`);
          setBusy(false);
          if (res.success) router.push(`/admin/messages?c=${id}`);
          else setError(res.message);
        }}
      >
        Join & reply
      </Button>
      {error && <span className="text-xs text-error">{error}</span>}
    </span>
  );
}
