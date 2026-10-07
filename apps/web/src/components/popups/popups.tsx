import type { PublicPopupView } from '@havenhub/shared';

import { cmsData } from '@/lib/cms';
import { getCurrentUser } from '@/lib/session';

import { PopupHost } from './popup-host';

/** Server side of pop-ups: the cached list and who is viewing. */
export async function Popups() {
  const [popups, user] = await Promise.all([
    cmsData<PublicPopupView[]>('/popups'),
    getCurrentUser(),
  ]);
  if (!popups || popups.length === 0) return null;
  return <PopupHost popups={popups} viewer={user?.accountType ?? null} />;
}
