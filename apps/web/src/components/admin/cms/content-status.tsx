import type { ContentStatus, PostDisplayStatus } from '@havenhub/shared';
import { Badge, type BadgeProps } from '@havenhub/ui';

const TONE: Record<PostDisplayStatus, BadgeProps['tone']> = {
  DRAFT: 'neutral',
  SCHEDULED: 'warning',
  PUBLISHED: 'success',
  ARCHIVED: 'neutral',
};
const LABEL: Record<PostDisplayStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

export function ContentStatusBadge({ status }: { status: ContentStatus | PostDisplayStatus }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}

export const CONTENT_STATUS_OPTIONS: [string, string][] = [
  ['DRAFT', 'Draft'],
  ['PUBLISHED', 'Published'],
  ['ARCHIVED', 'Archived'],
];
