import { Card } from '@havenhub/ui';

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <Card className="p-6">
      <p className="text-sm text-text-secondary">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-text tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </Card>
  );
}
