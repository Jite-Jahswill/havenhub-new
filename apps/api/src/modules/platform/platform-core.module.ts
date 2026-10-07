import { Global, Module } from '@nestjs/common';

import { MaintenanceGuard, MaintenanceStateService } from './maintenance';
import { ModerationPolicyService } from './moderation-policy.service';
import { PlatformPoliciesService } from './platform-policies.service';

/** Platform state read across the API: the maintenance switch, moderation and admin policies. */
@Global()
@Module({
  providers: [
    MaintenanceStateService,
    MaintenanceGuard,
    ModerationPolicyService,
    PlatformPoliciesService,
  ],
  exports: [
    MaintenanceStateService,
    MaintenanceGuard,
    ModerationPolicyService,
    PlatformPoliciesService,
  ],
})
export class PlatformCoreModule {}
