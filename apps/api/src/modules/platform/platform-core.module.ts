import { Global, Module } from '@nestjs/common';

import { MaintenanceGuard, MaintenanceStateService } from './maintenance';
import { ModerationPolicyService } from './moderation-policy.service';

/** Platform state read across the API: the maintenance switch and the moderation policy. */
@Global()
@Module({
  providers: [MaintenanceStateService, MaintenanceGuard, ModerationPolicyService],
  exports: [MaintenanceStateService, MaintenanceGuard, ModerationPolicyService],
})
export class PlatformCoreModule {}
