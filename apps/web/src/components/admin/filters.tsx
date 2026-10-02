import { Button, Input, Select } from '@havenhub/ui';

/** A plain GET form: filters live in the URL, so views are shareable and work without JS. */
type FilterSelect = {
  name: string;
  label: string;
  value: string | undefined;
  options: [string, string][];
};

export function Filters({
  search,
  select,
  selects = [],
  searchable = true,
  placeholder = 'Search by name, email or phone',
  hidden = {},
}: {
  search?: string | undefined;
  select?: FilterSelect;
  /** Additional dropdowns, rendered after `select`. */
  selects?: FilterSelect[];
  searchable?: boolean;
  placeholder?: string;
  /** Extra query parameters to keep (e.g. the active tab). */
  hidden?: Record<string, string>;
}) {
  const dropdowns = [...(select ? [select] : []), ...selects];
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
      {dropdowns.map((d) => (
        <Select
          key={d.name}
          name={d.name}
          defaultValue={d.value ?? ''}
          aria-label={d.label}
          className="sm:w-48"
        >
          <option value="">All</option>
          {d.options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      ))}
      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}
