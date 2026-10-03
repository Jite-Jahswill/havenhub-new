'use client';

import type { AdminUserListItem, Permission, RoleView } from '@havenhub/shared';
import { Alert, Button } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

/**
 * Edits an administrator's roles. Roles whose permissions the signed-in
 * admin does not all hold cannot be ticked; the API enforces every rule
 * (no self-changes, no escalation, at least one Super Admin).
 */
export function UserRolesAction({
  user,
  roles,
  held,
}: {
  user: AdminUserListItem;
  roles: RoleView[];
  held: Permission[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(user.roles));
  const { pending, error, setError, run } = useApiAction();
  const holds = new Set(held);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  function show() {
    setSelected(new Set(user.roles));
    setError(null);
    setOpen(true);
  }

  async function save() {
    const done = await run(() =>
      api('PUT', `/admin/users/${user.id}/roles`, { roleKeys: [...selected] }),
    );
    if (done) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={show} aria-haspopup="dialog">
        Edit roles
      </Button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-label={`Roles for ${user.fullName}`}
        className="m-auto w-[min(92vw,520px)] rounded-card border border-border bg-surface p-0 text-text shadow-raised backdrop:bg-black/50"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold">Roles for {user.fullName}</h2>
          <p className="text-xs break-all text-text-muted">{user.email}</p>
        </div>
        <fieldset className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-5 py-4">
          <legend className="sr-only">Roles</legend>
          {roles.map((role) => {
            const grantable = role.permissions.every((p) => holds.has(p));
            return (
              <label
                key={role.key}
                className={`flex items-start gap-3 text-sm ${grantable ? 'text-text' : 'text-text-muted'}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={selected.has(role.key)}
                  disabled={!grantable}
                  onChange={(e) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(role.key);
                      else next.delete(role.key);
                      return next;
                    })
                  }
                />
                <span className="min-w-0">
                  {role.name}
                  {!role.isSystem && <span className="text-text-muted"> · custom</span>}
                  {!grantable && (
                    <span className="block text-xs">Includes permissions you do not hold</span>
                  )}
                </span>
              </label>
            );
          })}
        </fieldset>
        {error && (
          <Alert tone="error" className="mx-5 mb-4">
            {error.message}
          </Alert>
        )}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button loading={pending} onClick={save}>
            Save roles
          </Button>
        </div>
      </dialog>
    </>
  );
}
