import type { BlogCategoryView, BlogTagView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PostEditor } from '@/components/admin/cms/post-editor';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApiData } from '@/lib/api/server';
import { getSite } from '@/lib/cms';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'New post' };

export default async function NewPostPage() {
  const user = await requireUser('ADMIN', '/admin/blog');

  const [categories, tags, site] = await Promise.all([
    serverApiData<BlogCategoryView[]>('/admin/blog/categories'),
    serverApiData<BlogTagView[]>('/admin/blog/tags'),
    getSite(),
  ]);
  const can = {
    create: hasPermission(user, 'blog.create'),
    edit: hasPermission(user, 'blog.edit'),
    publish: hasPermission(user, 'blog.publish'),
    remove: hasPermission(user, 'blog.delete'),
    upload: hasPermission(user, 'content.media'),
  };
  if (!categories || !tags || !hasPermission(user, 'blog.create')) return <NoAccess />;
  return (
    <>
      <Link href="/admin/blog" className="text-sm text-text-secondary hover:text-text">
        ← Blog
      </Link>
      <div className="mt-4">
        <PageHeader title={'New post'} />
      </div>
      <PostEditor
        post={null}
        categories={categories}
        tags={tags}
        mediaBase={site.mediaBase}
        can={can}
      />
    </>
  );
}
