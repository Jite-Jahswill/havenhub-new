'use client';

import type { AuthUser } from '@havenhub/shared';
import { Button } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { api, apiUpload } from '@/lib/api/client';

export function AvatarUploader({ user }: { user: AuthUser }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initials = user.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  async function upload(file: File | undefined) {
    if (!file) return;
    setPending(true);
    setError(null);
    const res = await apiUpload<AuthUser>('/users/me/avatar', file);
    setPending(false);
    if (input.current) input.current.value = '';
    if (!res.success) setError(res.message);
    router.refresh();
  }

  async function remove() {
    setPending(true);
    await api('DELETE', '/users/me/avatar');
    setPending(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-5">
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- pre-processed 400px avatar
        <img src={user.avatarUrl} alt="" className="size-20 rounded-full object-cover" />
      ) : (
        <span
          aria-hidden
          className="grid size-20 place-items-center rounded-full bg-surface-inverse text-2xl font-semibold text-text-inverse"
        >
          {initials}
        </span>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={pending}
            onClick={() => input.current?.click()}
          >
            {user.avatarUrl ? 'Change photo' : 'Upload photo'}
          </Button>
          {user.avatarUrl && (
            <Button variant="ghost" size="sm" disabled={pending} onClick={remove}>
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-text-muted">JPEG, PNG or WebP, up to 10 MB.</p>
        {error && (
          <p className="text-xs font-medium text-error" role="alert">
            {error}
          </p>
        )}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          aria-label="Upload profile photo"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
