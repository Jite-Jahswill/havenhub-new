import { getPublicPolicies } from '@/lib/cms';
import { getCurrentUser } from '@/lib/session';

import { AssistantWidget } from './assistant-widget';

/** Server side of the "Ask HavenHub" assistant: the admin settings and who is viewing. */
export async function Assistant() {
  const [policies, user] = await Promise.all([getPublicPolicies(), getCurrentUser()]);
  // Staff answer people from Admin → Support; the assistant is for visitors.
  if (!policies.assistant || user?.accountType === 'ADMIN') return null;
  return (
    <AssistantWidget
      greeting={policies.assistant.greeting}
      handoffEnabled={policies.assistant.handoffEnabled}
      viewer={user ? (user.accountType === 'AGENT' ? 'agent' : 'customer') : null}
    />
  );
}
