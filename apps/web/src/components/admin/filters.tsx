import { Button, Input, Select } from '@havenhub/ui';

/** A plain GET form: filters live in the URL, so views are shareable and work without JS. */
export function Filters({
  search,
  select,
  searchable = true,
  placeholder = 'Search by name, email or phone',
  hidden = {},
}: {
  search?: string | undefined;
  select: { name: string; label: string; value: string | undefined; options: [string, string][] };
  searchable?: boolean;
  placeholder?: string;
  /** Extra query parameters to keep (e.g. the active tab). */
  hidden?: Record<string, string>;
}) {
  return (
    <form role="search" className="mb-6 flex flex-col gap-3 sm:flex-row">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {searchable && (
        <Input
          name="search"
          defaultValue={search}
          placeholder={placeholder}
          aria-label="Search"
          className="sm:max-w-sm"
        />
      )}
      <Select
        name={select.name}
        defaultValue={select.value ?? ''}
        aria-label={select.label}
        className="sm:w-48"
      >
        <option value="">All</option>
        {select.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}
