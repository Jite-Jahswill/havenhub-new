'use client';

import {
  AmenityCategory,
  ErrorCode,
  createAmenitySchema,
  type AdminAmenityView,
} from '@havenhub/shared';
import { Alert, Badge, Button, Field, Input, Select } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { AMENITY_CATEGORY_LABELS } from '@/lib/labels';
import { useApiAction } from '@/lib/use-api-action';

import { EmptyRow, Table, Td, Th, Tr } from './table';

export function AmenityManager({ amenities }: { amenities: AdminAmenityView[] }) {
  const router = useRouter();
  const create = useApiAction();
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input = create.validate(createAmenitySchema, {
      name: formText(form, 'name'),
      category: formText(form, 'category'),
    });
    if (input && (await create.run(() => api('POST', '/admin/amenities', input)))) {
      formElement.reset();
      router.refresh();
    }
  }

  async function update(amenity: AdminAmenityView, patch: Record<string, unknown>) {
    setBusy(amenity.id);
    setRowError(null);
    const res = await api('PATCH', `/admin/amenities/${amenity.id}`, patch);
    setBusy(null);
    if (!res.success) setRowError(res.message);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <form
        onSubmit={onCreate}
        noValidate
        className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6 shadow-card sm:flex-row sm:items-end"
      >
        <Field label="New amenity" error={create.fieldErrors.name} className="flex-1">
          {(a) => <Input {...a} name="name" placeholder="e.g. Solar power" maxLength={60} />}
        </Field>
        <Field label="Category" error={create.fieldErrors.category} className="sm:w-56">
          {(a) => (
            <Select {...a} name="category" defaultValue="ESSENTIALS">
              {Object.values(AmenityCategory).map((c) => (
                <option key={c} value={c}>
                  {AMENITY_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" loading={create.pending}>
          Add amenity
        </Button>
      </form>
      {create.error && create.error.code !== ErrorCode.VALIDATION_ERROR && (
        <Alert tone="error">{create.error.message}</Alert>
      )}
      {rowError && <Alert tone="error">{rowError}</Alert>}

      <Table caption="Amenities">
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Category</Th>
            <Th>Used by</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {amenities.length === 0 && <EmptyRow colSpan={4}>No amenities yet.</EmptyRow>}
          {amenities.map((amenity) => (
            <Tr key={amenity.id}>
              <Td>
                <Input
                  aria-label={`Name of ${amenity.name}`}
                  defaultValue={amenity.name}
                  maxLength={60}
                  className="h-9 max-w-64"
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== amenity.name) void update(amenity, { name });
                  }}
                />
              </Td>
              <Td>
                <Select
                  aria-label={`Category of ${amenity.name}`}
                  value={amenity.category}
                  onChange={(e) => update(amenity, { category: e.target.value })}
                  className="h-9 w-48 text-xs"
                >
                  {Object.values(AmenityCategory).map((c) => (
                    <option key={c} value={c}>
                      {AMENITY_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Td>
              <Td className="text-text-secondary">{amenity.propertyCount} listings</Td>
              <Td>
                <div className="flex items-center gap-3">
                  <Badge tone={amenity.isActive ? 'success' : 'neutral'}>
                    {amenity.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === amenity.id}
                    onClick={() => update(amenity, { isActive: !amenity.isActive })}
                  >
                    {amenity.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
