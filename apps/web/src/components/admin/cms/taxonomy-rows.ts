import type { BlogCategoryView, BlogTagView, HelpCategoryView } from '@havenhub/shared';

/** Plain (server-safe) mappers for the taxonomy manager's rows. */
export type TaxonomyRow = { id: string; name: string; slug: string; count: number };

export const blogCategoryRows = (c: BlogCategoryView[]): TaxonomyRow[] =>
  c.map((x) => ({ id: x.id, name: x.name, slug: x.slug, count: x.postCount }));
export const blogTagRows = (t: BlogTagView[]): TaxonomyRow[] =>
  t.map((x) => ({ id: x.id, name: x.name, slug: x.slug, count: x.postCount }));
export const helpCategoryRows = (c: HelpCategoryView[]): TaxonomyRow[] =>
  c.map((x) => ({ id: x.id, name: x.name, slug: x.slug, count: x.articleCount }));
