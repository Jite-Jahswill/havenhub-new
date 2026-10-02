'use client';

import type { AgentOnboardingView } from '@havenhub/shared';
import { Button, Card, CardBody, cn } from '@havenhub/ui';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';

const STEP_LINKS: Partial<Record<AgentOnboardingView['steps'][number]['key'], string>> = {
  profile: '/agent/profile#business',
  identity: '/agent/profile#identity',
  payout: '/agent/profile#payout',
};

export function OnboardingChecklist({ onboarding }: { onboarding: AgentOnboardingView }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function setDismissed(dismissed: boolean) {
    setPending(true);
    await api('POST', `/agents/me/onboarding/${dismissed ? 'dismiss' : 'restore'}`);
    setPending(false);
    router.refresh();
  }

  if (onboarding.dismissed) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-card border border-dashed border-border px-6 py-4 text-sm">
        <span className="text-text-secondary">
          Getting started: {onboarding.completedCount} of {onboarding.steps.length} steps done.
        </span>
        <Button variant="ghost" size="sm" onClick={() => setDismissed(false)} loading={pending}>
          Show checklist
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-text">Welcome to HavenHub</h2>
            <p className="mt-1 text-sm text-text-secondary">
              {onboarding.completedCount} of {onboarding.steps.length} steps complete. You can come
              back to this any time.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setDismissed(true)} loading={pending}>
            Skip for now
          </Button>
        </div>
        <ol className="mt-6 flex flex-col gap-1">
          {onboarding.steps.map((step, index) => {
            const href = STEP_LINKS[step.key];
            const body = (
              <>
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                    step.completed
                      ? 'border-success bg-success text-white'
                      : 'border-border-strong text-text-secondary',
                  )}
                  aria-hidden
                >
                  {step.completed ? <Check className="size-4" strokeWidth={2.5} /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-sm font-medium',
                      step.completed ? 'text-text-secondary line-through' : 'text-text',
                    )}
                  >
                    {step.title}
                    <span className="sr-only">{step.completed ? ' (done)' : ''}</span>
                  </span>
                  <span className="block text-xs text-text-muted">
                    {step.available ? step.description : `${step.description} Available soon.`}
                  </span>
                </span>
              </>
            );
            return (
              <li key={step.key}>
                {href && !step.completed && step.available ? (
                  <Link
                    href={href}
                    className="flex items-center gap-4 rounded-control px-3 py-3 hover:bg-surface-secondary"
                  >
                    {body}
                  </Link>
                ) : (
                  <div
                    className={cn(
                      'flex items-center gap-4 px-3 py-3',
                      !step.available && 'opacity-60',
                    )}
                  >
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}
