'use client';

import { UserStatus, type AdminUserListItem } from '@havenhub/shared';
import { Select } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';

/** Inline status control. The API decides whether this admin may change this user. */
export function UserStatusAction({ user }: { user: AdminUserListItem }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(status: UserStatus) {
    if (status === user.status) return;
    const verb =
      status === UserStatus.ACTIVE ? 'reactivate' : status.toLowerCase().replace(/ed$/, '');
    if (
      !window.confirm(`Are you sure you want to ${verb} ${user.fullName}? They will be signed out.`)
    )
      return;
    setPending(true);
    setError(null);
    const res = await api('PATCH', `/admin/users/${user.id}/status`, { status });
    setPending(false);
    if (res.success) router.refresh();
    else setError(res.message);
  }

  return (
    <div>
      <Select
        aria-label={`Status for ${user.fullName}`}
        value={user.status}
        disabled={pending}
        onChange={(e) => change(e.target.value as UserStatus)}
        className="h-9 w-36 text-xs"
      >
        <option value={UserStatus.ACTIVE}>Active</option>
        <option value={UserStatus.SUSPENDED}>Suspended</option>
        <option value={UserStatus.BLOCKED}>Blocked</option>
      </Select>
      {error && <p className="mt-1 max-w-36 text-xs text-error">{error}</p>}
    </div>
  );
}
