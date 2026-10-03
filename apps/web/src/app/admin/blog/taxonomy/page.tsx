import type { BlogCategoryView, BlogTagView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { TaxonomyManager } from '@/components/admin/cms/taxonomy-manager';
import { blogCategoryRows, blogTagRows } from '@/components/admin/cms/taxonomy-rows';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Blog categories & tags' };

export default async function BlogTaxonomyPage() {
  await requireUser('ADMIN', '/admin/blog/taxonomy');
  const [cats, tags] = await Promise.all([
    serverApi<BlogCategoryView[]>('/admin/blog/categories'),
    serverApi<BlogTagView[]>('/admin/blog/tags'),
  ]);
  return (
    <>
      <Link href="/admin/blog" className="text-sm text-text-secondary hover:text-text">
        ← Blog
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Categories & tags"
          description="Anything still used by a post cannot be deleted."
        />
      </div>
      {!cats.success || !tags.success ? (
        <NoAccess />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <TaxonomyManager
            title="Categories"
            rows={blogCategoryRows(cats.data)}
            endpoint="/admin/blog/categories"
            countLabel="posts"
            renamable
          />
          <TaxonomyManager
            title="Tags"
            rows={blogTagRows(tags.data)}
            endpoint="/admin/blog/tags"
            countLabel="posts"
            renamable={false}
          />
        </div>
      )}
    </>
  );
}
