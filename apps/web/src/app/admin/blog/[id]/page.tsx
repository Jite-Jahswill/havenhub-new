import type { AdminPostView, BlogCategoryView, BlogTagView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PostEditor } from '@/components/admin/cms/post-editor';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi, serverApiData } from '@/lib/api/server';
import { getSite } from '@/lib/cms';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Edit post' };

export default async function EditPostPage({ params }: PageProps<'/admin/blog/[id]'>) {
  const user = await requireUser('ADMIN', '/admin/blog');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await serverApi<AdminPostView>(`/admin/blog/posts/${id}`);
  if (!res.success && res.code === 'NOT_FOUND') notFound();
  if (!res.success) return <NoAccess />;
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
  if (!categories || !tags) return <NoAccess />;
  return (
    <>
      <Link href="/admin/blog" className="text-sm text-text-secondary hover:text-text">
        ← Blog
      </Link>
      <div className="mt-4">
        <PageHeader title={res.data.title} />
      </div>
      <PostEditor
        key={res.data.updatedAt}
        post={res.data}
        categories={categories}
        tags={tags}
        mediaBase={site.mediaBase}
        can={can}
      />
    </>
  );
}
