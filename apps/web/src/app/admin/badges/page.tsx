import type { AdminBadgeView } from '@havenhub/shared';
import { Badge, buttonClasses } from '@havenhub/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Badges' };

function rules(b: AdminBadgeView) {
  if (b.mode === 'MANUAL') return 'Given by hand';
  return [
    b.minRating !== null && `★ ${b.minRating.toFixed(1)}+`,
    b.minReviews !== null && `${b.minReviews}+ reviews`,
    b.minCompletedBookings !== null && `${b.minCompletedBookings}+ completed stays`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export default async function BadgesPage() {
  const user = await requireUser('ADMIN', '/admin/badges');
  if (!hasPermission(user, 'badges.manage')) return <NoAccess />;
  const res = await serverApi<AdminBadgeView[]>('/admin/badges');
  return (
    <>
      <PageHeader
        title="Badges"
        description="Your own badges, shown on property cards and pages: given by hand or earned automatically."
        action={
          <Link href="/admin/badges/new" className={buttonClasses()}>
            <Plus aria-hidden className="size-4" /> New badge
          </Link>
        }
      />
      {res.success ? (
        <Table caption="Badges">
          <thead>
            <tr>
              <Th>Badge</Th>
              <Th>How it is given</Th>
              <Th className="text-right">Properties</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {res.data.length === 0 ? (
              <EmptyRow colSpan={4}>No badges yet. Create “Award winning” to get started.</EmptyRow>
            ) : (
              res.data.map((b) => (
                <Tr key={b.id}>
                  <Td>
                    <Link
                      href={`/admin/badges/${b.id}`}
                      className="flex items-center gap-3 font-medium text-text hover:underline"
                    >
                      <span className="relative size-9 shrink-0 overflow-hidden rounded-full border border-border bg-surface">
                        <Image
                          src={b.image.thumbnailUrl}
                          alt=""
                          fill
                          unoptimized
                          sizes="36px"
                          className="object-contain"
                        />
                      </span>
                      {b.name}
                    </Link>
                  </Td>
                  <Td className="text-sm text-text-secondary">{rules(b)}</Td>
                  <Td className="text-right tabular-nums">{b.holders}</Td>
                  <Td>{b.active ? <Badge tone="success">Shown</Badge> : <Badge>Hidden</Badge>}</Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      ) : (
        <NoAccess />
      )}
    </>
  );
}
