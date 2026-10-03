import { Module } from '@nestjs/common';

import { CmsModule } from '../cms/cms.module';
import { AdminSettingsController, PlatformStatusController } from './platform.controller';
import { PlatformSettingsService } from './platform-settings.service';
import { SmtpSettingsService } from './smtp-settings.service';

@Module({
  imports: [CmsModule],
  controllers: [PlatformStatusController, AdminSettingsController],
  providers: [PlatformSettingsService, SmtpSettingsService],
})
export class PlatformModule {}
