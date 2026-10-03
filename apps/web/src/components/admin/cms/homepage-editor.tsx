'use client';

import type { AdminHomepageSection, ApiError } from '@havenhub/shared';
import { Alert, Badge, Button, Card, CardBody, Field, Input } from '@havenhub/ui';
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { fieldErrors as toFieldErrors } from '@/lib/api/errors';

type Link = { label: string; href: string };
type Item = { title: string; description: string | null; href: string };

/**
 * The homepage builder: switch sections on or off, order them (buttons, so
 * it works by touch and keyboard), and edit each one's wording and links.
 */
export function HomepageEditor({ sections }: { sections: AdminHomepageSection[] }) {
  const router = useRouter();
  const [order, setOrder] = useState(sections);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  async function move(index: number, delta: number) {
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    setOrder(next);
    setMoving(true);
    const res = await api('PUT', '/admin/cms/homepage/order', { keys: next.map((s) => s.key) });
    setMoving(false);
    if (!res.success) {
      setError(res.message);
      setOrder(order);
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      <ol className="flex flex-col gap-3">
        {order.map((section, index) => (
          <li key={section.key}>
            <SectionCard
              section={section}
              first={index === 0}
              last={index === order.length - 1}
              moving={moving}
              onMove={(d) => void move(index, d)}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function SectionCard({
  section,
  first,
  last,
  moving,
  onMove,
}: {
  section: AdminHomepageSection;
  first: boolean;
  last: boolean;
  moving: boolean;
  onMove: (delta: number) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(section.enabled);
  const [title, setTitle] = useState(section.title ?? '');
  const [subtitle, setSubtitle] = useState(section.subtitle ?? '');
  const [config, setConfig] = useState<Record<string, unknown>>(section.config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const errors = toFieldErrors(error);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setSaved(false);
    setError(null);
    const res = await api('PATCH', `/admin/cms/homepage/${section.key}`, patch);
    setBusy(false);
    if (!res.success) setError(res);
    else {
      setSaved(true);
      router.refresh();
    }
    return res.success;
  }

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    if (!(await save({ enabled: next }))) setEnabled(!next);
  }

  const links = (config.links as Link[] | undefined) ?? [];
  const items = (config.items as Item[] | undefined) ?? [];
  const button = (config.button as Link | null | undefined) ?? null;
  const set = (key: string, value: unknown) => setConfig((c) => ({ ...c, [key]: value }));
  const isListing = !['HERO', 'EXPLORE', 'CTA'].includes(section.key);

  return (
    <Card>
      <CardBody className="flex flex-col gap-4 !py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move ${section.label} up`}
              disabled={first || moving}
              onClick={() => onMove(-1)}
            >
              <ArrowUp aria-hidden className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move ${section.label} down`}
              disabled={last || moving}
              onClick={() => onMove(1)}
            >
              <ArrowDown aria-hidden className="size-4" />
            </Button>
          </div>
          <div className="min-w-0 flex-1 basis-40">
            <p className="font-semibold text-text">{section.label}</p>
            {!section.available && (
              <p className="text-xs text-text-muted">{section.unavailableReason}</p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {section.available ? (
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => void toggle()}
                  disabled={busy}
                  className="size-4 accent-primary"
                />
                {enabled ? 'Shown' : 'Hidden'}
              </label>
            ) : (
              <Badge>Not available yet</Badge>
            )}
            {section.available && (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
              >
                Edit{' '}
                <ChevronDown
                  aria-hidden
                  className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </Button>
            )}
          </div>
        </div>

        {error && !open && <Alert tone="error">{error.message}</Alert>}

        {open && (
          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={section.key === 'HERO' ? 'Headline' : 'Heading'}
                optional
                error={errors.title}
              >
                {(a) => (
                  <Input
                    {...a}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                  />
                )}
              </Field>
              <Field label="Subheading" optional error={errors.subtitle}>
                {(a) => (
                  <Input
                    {...a}
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    maxLength={300}
                  />
                )}
              </Field>
            </div>

            {section.key === 'HERO' && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Eyebrow" optional error={errors['config.eyebrow']}>
                    {(a) => (
                      <Input
                        {...a}
                        value={(config.eyebrow as string) ?? ''}
                        onChange={(e) => set('eyebrow', e.target.value)}
                        maxLength={80}
                      />
                    )}
                  </Field>
                  <Field
                    label="Search placeholder"
                    optional
                    error={errors['config.searchPlaceholder']}
                  >
                    {(a) => (
                      <Input
                        {...a}
                        value={(config.searchPlaceholder as string) ?? ''}
                        onChange={(e) => set('searchPlaceholder', e.target.value)}
                        maxLength={80}
                      />
                    )}
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={Boolean(config.showSearch)}
                    onChange={(e) => set('showSearch', e.target.checked)}
                    className="size-4 accent-primary"
                  />
                  Show the search box
                </label>
                <LinkList
                  title="Quick links"
                  links={links}
                  max={6}
                  onChange={(l) => set('links', l)}
                  errors={errors}
                  prefix="config.links"
                />
              </>
            )}

            {section.key === 'EXPLORE' && (
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-sm font-medium text-text">Tiles</legend>
                {items.map((item, i) => (
                  <div
                    key={i}
                    className="grid gap-2 rounded-control border border-border p-3 sm:grid-cols-[1fr_2fr_1fr_auto]"
                  >
                    <Input
                      aria-label="Tile title"
                      value={item.title}
                      maxLength={40}
                      onChange={(e) =>
                        set(
                          'items',
                          items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                        )
                      }
                    />
                    <Input
                      aria-label="Tile description"
                      value={item.description ?? ''}
                      maxLength={160}
                      onChange={(e) =>
                        set(
                          'items',
                          items.map((x, j) =>
                            j === i ? { ...x, description: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <Input
                      aria-label="Tile link"
                      value={item.href}
                      placeholder="/properties"
                      onChange={(e) =>
                        set(
                          'items',
                          items.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)),
                        )
                      }
                      aria-invalid={errors[`config.items.${i}.href`] ? true : undefined}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label="Remove tile"
                      onClick={() =>
                        set(
                          'items',
                          items.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </div>
                ))}
                {items.length < 12 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="self-start"
                    onClick={() =>
                      set('items', [...items, { title: '', description: '', href: '/' }])
                    }
                  >
                    <Plus aria-hidden className="size-4" /> Add tile
                  </Button>
                )}
              </fieldset>
            )}

            {section.key === 'CTA' && (
              <LinkList
                title="Button"
                links={button ? [button] : []}
                max={1}
                onChange={(l) => set('button', l[0] ?? null)}
                errors={errors}
                prefix="config.button"
                single
              />
            )}

            {isListing && (
              <Field
                label="How many to show"
                hint="1–12. The section is hidden while there is nothing public to show."
                error={errors['config.limit']}
              >
                {(a) => (
                  <Input
                    {...a}
                    type="number"
                    min={1}
                    max={12}
                    value={String((config.limit as number | undefined) ?? 6)}
                    onChange={(e) => set('limit', Number(e.target.value))}
                    className="sm:w-32"
                  />
                )}
              </Field>
            )}

            {error && <Alert tone="error">{error.message}</Alert>}
            {saved && <Alert tone="success">Saved.</Alert>}
            <Button
              loading={busy}
              className="self-end"
              onClick={() =>
                void save({
                  title: title,
                  subtitle: subtitle,
                  config: isListing ? { limit: Number(config.limit ?? 6) } : config,
                })
              }
            >
              Save section
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function LinkList({
  title,
  links,
  max,
  onChange,
  errors,
  prefix,
  single = false,
}: {
  title: string;
  links: Link[];
  max: number;
  onChange: (links: Link[]) => void;
  errors: Record<string, string>;
  prefix: string;
  single?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-text">{title}</legend>
      {links.map((l, i) => {
        const path = single ? prefix : `${prefix}.${i}`;
        return (
          <div key={i} className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Label"
              placeholder="Label"
              value={l.label}
              maxLength={40}
              onChange={(e) =>
                onChange(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
              }
            />
            <Input
              aria-label="Link"
              placeholder="/properties or https://…"
              value={l.href}
              onChange={(e) =>
                onChange(links.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))
              }
              aria-invalid={errors[`${path}.href`] ? true : undefined}
            />
            <Button
              type="button"
              variant="ghost"
              aria-label="Remove"
              onClick={() => onChange(links.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </div>
        );
      })}
      {Object.entries(errors)
        .filter(([k]) => k.startsWith(prefix))
        .slice(0, 1)
        .map(([k, m]) => (
          <p key={k} className="text-xs font-medium text-error">
            {m}
          </p>
        ))}
      {links.length < max && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => onChange([...links, { label: '', href: '/' }])}
        >
          <Plus aria-hidden className="size-4" /> Add {single ? 'button' : 'link'}
        </Button>
      )}
    </fieldset>
  );
}
