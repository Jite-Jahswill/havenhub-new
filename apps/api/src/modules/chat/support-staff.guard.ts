import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { AccountType } from '@havenhub/shared';
import type { Request } from 'express';

import { Errors } from '../../common/errors/app.exception';

/**
 * Admins may use the participant chat endpoints only as support staff
 * (`support.respond`), and only see conversations they have joined (the
 * participant check in every service still applies). Customers and agents
 * are unaffected.
 */
@Injectable()
export class SupportStaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (auth?.user.accountType === AccountType.ADMIN && !auth.permissions.has('support.respond')) {
      throw Errors.insufficientPermissions();
    }
    return true;
  }
}
