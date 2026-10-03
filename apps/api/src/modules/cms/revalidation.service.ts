import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

/**
 * Asks the web app to drop its cached CMS pages after an admin change
 * (server-to-server, authenticated by REVALIDATE_SECRET). Best effort: a
 * failure never fails the admin's request — pages then refresh on their own
 * short revalidate interval.
 */
@Injectable()
export class RevalidationService {
  private readonly logger = new Logger(RevalidationService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  trigger(): void {
    const secret = this.env.REVALIDATE_SECRET;
    if (!secret) return;
    const base = (this.env.WEB_INTERNAL_URL ?? this.env.WEB_APP_URL).replace(/\/+$/, '');
    fetch(`${base}/internal/revalidate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify({ tag: 'cms' }),
      signal: AbortSignal.timeout(3000),
    })
      .then((res) => {
        if (!res.ok) this.logger.warn(`Web revalidation answered ${res.status}`);
      })
      .catch((error: Error) => this.logger.warn(`Web revalidation failed: ${error.message}`));
  }
}
