import { Global, Module } from '@nestjs/common';

import { RbacService } from './rbac.service';
import { RolesService } from './roles.service';

@Global()
@Module({
  providers: [RbacService, RolesService],
  exports: [RbacService, RolesService],
})
export class RbacModule {}
