import type { AgentPlanUsageView } from '@havenhub/shared';
import { Badge, Card, CardBody, CardHeader } from '@havenhub/ui';

export function PlanCard({ plan }: { plan: AgentPlanUsageView }) {
  return (
    <Card>
      <CardHeader
        title="Your plan"
        description="Paid plans with more listings arrive soon."
        action={<Badge tone="primary">{plan.planName}</Badge>}
      />
      <CardBody className="flex flex-col gap-5">
        {plan.usage.map((item) =>
          item.used === null ? (
            <div key={item.key} className="flex items-baseline justify-between text-sm">
              <span className="text-text-secondary">{item.label}</span>
              <span className="text-text tabular-nums">Up to {item.limit ?? '∞'}</span>
            </div>
          ) : (
            <div key={item.key}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-text">{item.label}</span>
                <span className="text-text-secondary tabular-nums">
                  {item.used} / {item.limit ?? '∞'}
                </span>
              </div>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-surface-secondary"
                role="progressbar"
                aria-label={`${item.label} used`}
                aria-valuenow={item.used}
                aria-valuemin={0}
                aria-valuemax={item.limit ?? undefined}
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${item.limit ? Math.min(100, Math.round((item.used / item.limit) * 100)) : 0}%`,
                  }}
                />
              </div>
            </div>
          ),
        )}
      </CardBody>
    </Card>
  );
}
