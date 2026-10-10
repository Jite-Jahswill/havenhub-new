import type { AssistantQuestionView, AssistantStatsView, Paginated } from '@havenhub/shared';
import { Badge, buttonClasses } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatMoment } from '@/lib/format';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Assistant' };

const INTENT_LABELS: Record<string, string> = {
  GREETING: 'Greetings',
  THANKS: 'Thanks',
  CAPABILITIES: 'What can you do',
  HANDOFF: 'Asked for a person',
  REFUND_STATUS: 'Refund status',
  BOOKING_STATUS: 'Booking status',
  PROPERTY_SEARCH: 'Property search',
  EXPERIENCE_SEARCH: 'Tours, events, hotels',
  FAQ: 'Help and FAQs',
  UNKNOWN: 'Not understood',
};

/**
 * What visitors ask the "Ask HavenHub" assistant. Questions it could not
 * answer show where an FAQ or help article would help. Settings (on/off,
 * greeting, "Talk to a person") are in Admin → Settings → Assistant.
 */
export default async function AdminAssistantPage({ searchParams }: PageProps<'/admin/assistant'>) {
  await requireUser('ADMIN', '/admin/assistant');
  const sp = await searchParams;
  const all = sp.show === 'all';
  const page = typeof sp.page === 'string' && /^\d{1,4}$/.test(sp.page) ? sp.page : '1';
  const [stats, questions] = await Promise.all([
    serverApi<AssistantStatsView>('/admin/assistant/stats'),
    serverApi<Paginated<AssistantQuestionView>>(
      `/admin/assistant/questions?unanswered=${!all}&page=${page}`,
    ),
  ]);
  const chip =
    'rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-text hover:bg-surface-secondary aria-[current=page]:bg-surface-inverse aria-[current=page]:text-text-inverse';
  return (
    <>
      <PageHeader
        title="Assistant"
        description="What people ask the “Ask HavenHub” assistant. Add an FAQ or help article for questions it couldn’t answer."
        action={
          stats.success ? (
            <div className="flex gap-2">
              <Link href="/admin/help" className={buttonClasses({ variant: 'secondary' })}>
                Help &amp; FAQs
              </Link>
              <Link href="/admin/support" className={buttonClasses({ variant: 'secondary' })}>
                Support queue
              </Link>
            </div>
          ) : undefined
        }
      />
      {!stats.success || !questions.success ? (
        <NoAccess />
      ) : (
        <>
          <section aria-label="Last 30 days" className="mb-8 grid gap-4 sm:grid-cols-3">
            {[
              ['Questions (30 days)', stats.data.questions],
              [
                'Answered',
                stats.data.questions
                  ? `${Math.round((stats.data.answered / stats.data.questions) * 100)}%`
                  : '—',
              ],
              ['Passed to a person', stats.data.handedOff],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-card border border-border bg-surface p-5 shadow-card"
              >
                <p className="text-sm text-text-secondary">{label}</p>
                <p className="mt-1 text-2xl font-bold text-text">{value}</p>
              </div>
            ))}
          </section>
          {stats.data.byIntent.length > 0 && (
            <p className="mb-6 flex flex-wrap gap-2 text-sm">
              {stats.data.byIntent.map((i) => (
                <Badge key={i.intent}>
                  {INTENT_LABELS[i.intent] ?? i.intent}: {i.count}
                </Badge>
              ))}
            </p>
          )}

          <nav aria-label="Questions" className="mb-6 flex flex-wrap gap-2">
            <Link href="/admin/assistant" aria-current={!all ? 'page' : undefined} className={chip}>
              Not answered
            </Link>
            <Link
              href="/admin/assistant?show=all"
              aria-current={all ? 'page' : undefined}
              className={chip}
            >
              All questions
            </Link>
          </nav>
          <Table caption="Questions asked">
            <thead>
              <tr>
                <Th>Question</Th>
                <Th>Understood as</Th>
                <Th>From</Th>
                <Th>Asked</Th>
              </tr>
            </thead>
            <tbody>
              {questions.data.items.length === 0 && (
                <EmptyRow colSpan={4}>No questions here yet.</EmptyRow>
              )}
              {questions.data.items.map((q) => (
                <Tr key={q.id}>
                  <Td className="max-w-md break-words">{q.text}</Td>
                  <Td className="whitespace-nowrap">
                    {INTENT_LABELS[q.intent] ?? q.intent}
                    {q.handedOff && (
                      <Badge tone="warning" className="ml-2">
                        Passed to support
                      </Badge>
                    )}
                    {!q.answered && !q.handedOff && (
                      <Badge tone="warning" className="ml-2">
                        No answer
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-text-secondary">{q.user?.name ?? 'Visitor'}</Td>
                  <Td className="whitespace-nowrap text-text-secondary">
                    {formatMoment(q.createdAt)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={questions.data}
            basePath="/admin/assistant"
            params={{ show: all ? 'all' : undefined, page }}
          />
        </>
      )}
    </>
  );
}
