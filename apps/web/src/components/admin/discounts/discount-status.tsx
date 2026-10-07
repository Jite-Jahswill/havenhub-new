import type { AdminDiscountCodeView } from '@havenhub/shared';
import { Badge } from '@havenhub/ui';

/** Whether agents can use the code right now, and if not, why. */
export function DiscountStatus({ code }: { code: AdminDiscountCodeView }) {
  if (!code.active) return <Badge>Switched off</Badge>;
  if (code.endsAt && new Date(code.endsAt) <= new Date()) return <Badge>Expired</Badge>;
  if (code.maxRedemptions !== null && code.redeemed >= code.maxRedemptions) {
    return <Badge>Used up</Badge>;
  }
  return <Badge tone="success">Active</Badge>;
}
