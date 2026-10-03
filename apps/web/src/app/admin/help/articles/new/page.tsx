import type { HelpCategoryView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ArticleEditor } from '@/components/admin/cms/article-editor';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApiData } from '@/lib/api/server';
import { getSite } from '@/lib/cms';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'New help article' };

export default async function NewArticlePage() {
  const user = await requireUser('ADMIN', '/admin/help');

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
        <PageHeader title={'New help article'} />
      </div>
      <ArticleEditor
        article={null}
        categories={categories}
        mediaBase={site.mediaBase}
        canUpload={hasPermission(user, 'content.media')}
      />
    </>
  );
}
