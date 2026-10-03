import type {
  AdminFaqView,
  AdminHelpArticleView,
  HelpCategoryView,
  Paginated,
} from '@havenhub/shared';
import { buttonClasses } from '@havenhub/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { CONTENT_STATUS_OPTIONS, ContentStatusBadge } from '@/components/admin/cms/content-status';
import { FaqManager } from '@/components/admin/cms/faq-manager';
import { TaxonomyManager } from '@/components/admin/cms/taxonomy-manager';
import { helpCategoryRows } from '@/components/admin/cms/taxonomy-rows';
import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { getSite } from '@/lib/cms';
import { formatDate } from '@/lib/format';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Help centre' };
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

export default async function AdminHelpPage({ searchParams }: PageProps<'/admin/help'>) {
  const user = await requireUser('ADMIN', '/admin/help');
  const sp = await searchParams;
  const params = { search: str(sp.search), status: str(sp.status), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const [articles, categories, faqs, site] = await Promise.all([
    serverApi<Paginated<AdminHelpArticleView>>(`/admin/help/articles?${query}`),
    serverApi<HelpCategoryView[]>('/admin/help/categories'),
    serverApi<AdminFaqView[]>('/admin/help/faqs'),
    getSite(),
  ]);
  if (!articles.success || !categories.success || !faqs.success) {
    return (
      <>
        <PageHeader title="Help centre" />
        <NoAccess />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Help centre"
        description={
          site.features.helpCenter
            ? 'The help centre is live.'
            : 'The help centre is switched off in site settings.'
        }
        action={
          <Link href="/admin/help/articles/new" className={buttonClasses()}>
            <Plus aria-hidden className="size-4" /> New article
          </Link>
        }
      />
      <section aria-label="Articles" className="mb-10">
        <Filters
          search={params.search}
          placeholder="Search articles"
          select={{
            name: 'status',
            label: 'Status',
            value: params.status,
            options: CONTENT_STATUS_OPTIONS,
          }}
        />
        <Table caption="Help articles">
          <thead>
            <tr>
              <Th>Article</Th>
              <Th>Category</Th>
              <Th>Updated</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {articles.data.items.length === 0 && <EmptyRow colSpan={4}>No articles yet.</EmptyRow>}
            {articles.data.items.map((a) => (
              <Tr key={a.id} className="hover:bg-surface-secondary/60">
                <Td>
                  <Link
                    href={`/admin/help/articles/${a.id}`}
                    className="font-medium hover:underline"
                  >
                    {a.title}
                  </Link>
                </Td>
                <Td className="text-text-secondary">{a.categoryName}</Td>
                <Td className="whitespace-nowrap text-text-secondary">{formatDate(a.updatedAt)}</Td>
                <Td>
                  <ContentStatusBadge status={a.status} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <Pagination page={articles.data} basePath="/admin/help" params={params} />
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <TaxonomyManager
          title="Categories"
          rows={helpCategoryRows(categories.data)}
          endpoint="/admin/help/categories"
          countLabel="articles"
          renamable
        />
        <FaqManager
          faqs={faqs.data}
          categories={categories.data}
          mediaBase={site.mediaBase}
          canUpload={hasPermission(user, 'content.media')}
        />
      </div>
    </>
  );
}
