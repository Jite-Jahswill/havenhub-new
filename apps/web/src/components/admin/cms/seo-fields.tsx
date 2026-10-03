'use client';

import type { CmsImage } from '@havenhub/shared';
import { Field, Input, Textarea } from '@havenhub/ui';

import { ImageField } from './image-field';

export interface SeoValue {
  seoTitle: string;
  seoDescription: string;
  ogImage?: CmsImage | null;
  noIndex?: boolean;
}

/** Search & social fields shared by pages, posts, articles and jobs. */
export function SeoFields({
  value,
  onChange,
  errors,
  canUpload,
  withImage = false,
  withNoIndex = false,
}: {
  value: SeoValue;
  onChange: (value: SeoValue) => void;
  errors: Record<string, string>;
  canUpload: boolean;
  withImage?: boolean;
  withNoIndex?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Search title"
        optional
        hint="Up to 70 characters. Defaults to the title."
        error={errors.seoTitle}
      >
        {(a) => (
          <Input
            {...a}
            value={value.seoTitle}
            onChange={(e) => onChange({ ...value, seoTitle: e.target.value })}
            maxLength={70}
          />
        )}
      </Field>
      <Field
        label="Search description"
        optional
        hint="Up to 200 characters."
        error={errors.seoDescription}
      >
        {(a) => (
          <Textarea
            {...a}
            rows={2}
            value={value.seoDescription}
            onChange={(e) => onChange({ ...value, seoDescription: e.target.value })}
            maxLength={200}
          />
        )}
      </Field>
      {withImage && (
        <ImageField
          label="Social sharing image"
          value={value.ogImage ?? null}
          onChange={(ogImage) => onChange({ ...value, ogImage })}
          canUpload={canUpload}
        />
      )}
      {withNoIndex && (
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={Boolean(value.noIndex)}
            onChange={(e) => onChange({ ...value, noIndex: e.target.checked })}
            className="size-4 accent-primary"
          />
          Hide from search engines (noindex)
        </label>
      )}
    </div>
  );
}
