import type { AdminHelpArticleView, HelpCategoryView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArticleEditor } from '@/components/admin/cms/article-editor';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi, serverApiData } from '@/lib/api/server';
import { getSite } from '@/lib/cms';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Edit help article' };

export default async function EditArticlePage({ params }: PageProps<'/admin/help/articles/[id]'>) {
  const user = await requireUser('ADMIN', '/admin/help');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await serverApi<AdminHelpArticleView>(`/admin/help/articles/${id}`);
  if (!res.success && res.code === 'NOT_FOUND') notFound();
  if (!res.success) return <NoAccess />;
  const [categories, site] = await Promise.all([
    serverApiData<HelpCategoryView[]>('/admin/help/categories'),
    getSite(),
  ]);
  if (!categories) return <NoAccess />;
  return (
    <>
      <Link href="/admin/help" className="text-sm text-text-secondary hover:text-text">
        ← Help centre
      </Link>
      <div className="mt-4">
        <PageHeader title={res.data.title} />
      </div>
      <ArticleEditor
        key={res.data.updatedAt}
        article={res.data}
        categories={categories}
        mediaBase={site.mediaBase}
        canUpload={hasPermission(user, 'content.media')}
      />
    </>
  );
}
