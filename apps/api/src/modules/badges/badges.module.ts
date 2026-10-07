import { Global, Module } from '@nestjs/common';

import { CmsModule } from '../cms/cms.module';
import { AdminBadgesController } from './badges.controller';
import { BadgesService } from './badges.service';

/** Badges; global because reviews and completed stays recalculate earned badges. */
@Global()
@Module({
  imports: [CmsModule],
  controllers: [AdminBadgesController],
  providers: [BadgesService],
  exports: [BadgesService],
})
export class BadgesModule {}
