import { cn } from '@havenhub/ui';

import { getPublicPolicies } from '@/lib/cms';
import { getCurrentUser } from '@/lib/session';

import { OpenAssistantButton } from './open-assistant';

/** Homepage pitch for the assistant; shown only when the assistant is on for this viewer. */
export async function AssistantPrompt({ onImage }: { onImage: boolean }) {
  const [policies, user] = await Promise.all([getPublicPolicies(), getCurrentUser()]);
  if (!policies.assistant || user?.accountType === 'ADMIN') return null;
  return (
    <div
      className={cn(
        'mt-8 flex max-w-xl flex-col gap-3 rounded-card border p-4 text-sm sm:flex-row sm:items-center sm:gap-4',
        onImage
          ? 'border-white/30 bg-black/25 text-white/90 backdrop-blur'
          : 'border-border bg-surface text-text-secondary shadow-card',
      )}
    >
      <p className="text-pretty">
        HavenHub is here to make life easier. Just type what you’re looking for and relax — our AI
        finds homes and tours within your budget and brings them to you.
      </p>
      <OpenAssistantButton className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground hover:bg-primary-hover sm:self-center" />
    </div>
  );
}
