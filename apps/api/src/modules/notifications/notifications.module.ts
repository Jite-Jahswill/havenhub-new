import { Global, Module } from '@nestjs/common';

import { NotificationBroadcastsService } from './notification-broadcasts.service';
import { AdminNotificationsController, NotificationsController } from './notifications.controller';
import { NotificationsMaintenanceService } from './notifications-maintenance.service';
import { NotificationsService } from './notifications.service';

/** In-app notifications: every feature writes to inboxes through NotificationsService. */
@Global()
@Module({
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [NotificationsService, NotificationBroadcastsService, NotificationsMaintenanceService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
