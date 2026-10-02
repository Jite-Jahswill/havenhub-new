import { SetMetadata } from '@nestjs/common';

export interface RateLimitRule {
  /** Unique bucket name, e.g. "login:ip". */
  name: string;
  limit: number;
  windowSeconds: number;
  /**
   * What identifies the caller: client IP, IP + submitted email, the
   * submitted email alone (to stop mail-bombing), or the signed-in user.
   */
  by: 'ip' | 'ip+email' | 'email' | 'user';
}

export const RATE_LIMIT = 'rateLimit:rules';

export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT, rules);
