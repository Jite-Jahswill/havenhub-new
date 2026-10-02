import { Card } from '@havenhub/ui';
import { ShieldAlert } from 'lucide-react';

export function NoAccess() {
  return (
    <Card className="flex flex-col items-center px-6 py-16 text-center">
      <ShieldAlert aria-hidden className="size-8 text-text-muted" strokeWidth={1.6} />
      <h2 className="mt-4 font-semibold text-text">You don’t have access to this area</h2>
      <p className="mt-2 max-w-sm text-sm text-text-secondary">
        Ask a Super Admin to grant your account the required role.
      </p>
    </Card>
  );
}
