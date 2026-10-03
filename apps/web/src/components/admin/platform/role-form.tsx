'use client';

import {
  PERMISSIONS,
  PERMISSION_KEYS,
  createRoleSchema,
  updateRoleSchema,
  type Permission,
  type RoleDetail,
} from '@havenhub/shared';
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Textarea } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

const GROUP_LABELS: Record<string, string> = {
  users: 'Users',
  agents: 'Agents',
  properties: 'Properties',
  amenities: 'Amenities',
  experiences: 'Events, tours, hotels & cleaning',
  vacation_zones: 'Destinations',
  bookings: 'Bookings',
  payments: 'Payments',
  subscriptions: 'Subscriptions',
  conversations: 'Conversations',
  messages: 'Messages',
  blog: 'Blog',
  content: 'Site content',
  help: 'Help centre',
  careers: 'Careers',
  marketing: 'Email marketing',
  support: 'Support',
  seo: 'SEO',
  settings: 'Settings',
  analytics: 'Analytics',
  audit: 'Audit log',
  roles: 'Roles',
};

const GROUPS = PERMISSION_KEYS.reduce<Record<string, Permission[]>>((groups, key) => {
  const group = key.split('.')[0]!;
  (groups[group] ??= []).push(key);
  return groups;
}, {});

/**
 * Create or edit a custom role. Permissions the signed-in admin does not
 * hold are shown but cannot be ticked — the API refuses them regardless.
 */
export function RoleForm({ role, held }: { role?: RoleDetail; held: Permission[] }) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [selected, setSelected] = useState<Set<Permission>>(new Set(role?.permissions ?? []));
  const holds = new Set(held);

  function toggle(key: Permission, on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const values = {
      name: formText(f, 'name'),
      description: formText(f, 'description'),
      permissions: [...selected],
    };
    const input = validate(role ? updateRoleSchema : createRoleSchema, values);
    if (!input) return;
    const saved = await run(() =>
      role
        ? api<RoleDetail>('PATCH', `/admin/rbac/roles/${role.key}`, input)
        : api<RoleDetail>('POST', '/admin/rbac/roles', input),
    );
    if (saved) {
      router.push(`/admin/rbac/${saved.key}`);
      router.refresh();
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Details" />
        <CardBody className="flex flex-col gap-5">
          <Field label="Name" error={fieldErrors.name}>
            {(a) => (
              <Input {...a} name="name" defaultValue={role?.name ?? ''} maxLength={100} required />
            )}
          </Field>
          <Field label="Description" optional error={fieldErrors.description}>
            {(a) => (
              <Textarea
                {...a}
                name="description"
                rows={2}
                defaultValue={role?.description ?? ''}
                maxLength={500}
              />
            )}
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Permissions"
          description="You can only include permissions your own account holds."
        />
        <CardBody className="flex flex-col gap-6">
          {fieldErrors.permissions && (
            <p className="text-sm font-medium text-error">{fieldErrors.permissions}</p>
          )}
          {Object.entries(GROUPS).map(([group, keys]) => (
            <fieldset key={group} className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-text">
                {GROUP_LABELS[group] ?? group}
              </legend>
              {keys.map((key) => {
                const allowed = holds.has(key);
                return (
                  <label
                    key={key}
                    className={`flex items-start gap-3 text-sm ${allowed ? 'text-text' : 'text-text-muted'}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      checked={selected.has(key)}
                      disabled={!allowed}
                      onChange={(e) => toggle(key, e.target.checked)}
                    />
                    <span className="min-w-0">
                      {PERMISSIONS[key]}
                      <span className="block font-mono text-xs break-all text-text-muted">
                        {key}
                        {!allowed && ' · you do not hold this'}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ))}
        </CardBody>
      </Card>
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      <div>
        <Button type="submit" loading={pending}>
          {role ? 'Save role' : 'Create role'}
        </Button>
      </div>
    </form>
  );
}

/** Deletes a custom role; the API refuses while anyone holds it. */
export function DeleteRole({ roleKey, name }: { roleKey: string; name: string }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  async function remove() {
    if (!window.confirm(`Delete the role “${name}”? This cannot be undone.`)) return;
    if (await run(() => api('DELETE', `/admin/rbac/roles/${roleKey}`))) {
      router.push('/admin/rbac');
      router.refresh();
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="danger" loading={pending} onClick={remove}>
        Delete role
      </Button>
      {error && <Alert tone="error">{error.message}</Alert>}
    </div>
  );
}
