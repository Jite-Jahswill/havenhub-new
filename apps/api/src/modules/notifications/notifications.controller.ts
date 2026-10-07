import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  AccountType,
  notificationListQuerySchema,
  paginationQuerySchema,
  sendBroadcastSchema,
} from '@havenhub/shared';
import type { Request } from 'express';
import type { z } from 'zod';

import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  RequirePermissions,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { NotificationBroadcastsService } from './notification-broadcasts.service';
import { NotificationsService } from './notifications.service';

const uuid = new ParseUUIDPipe();

/** The signed-in user's own inbox. */
@Controller('notifications')
@AccountTypes(AccountType.CUSTOMER, AccountType.AGENT, AccountType.ADMIN)
@RequireVerifiedEmail()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query(validate(notificationListQuerySchema))
    query: z.output<typeof notificationListQuerySchema>,
  ) {
    return ok(await this.notifications.list(auth.user.id, query));
  }

  @Get('unread')
  async unread(@CurrentAuth() auth: AuthContext) {
    return ok(await this.notifications.unreadCount(auth.user.id));
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async readAll(@CurrentAuth() auth: AuthContext) {
    return ok(await this.notifications.markAllRead(auth.user.id));
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async read(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return ok(await this.notifications.markRead(auth.user.id, id));
  }
}

/** Announcements from administrators (`notifications.send`). */
@Controller('admin/notifications')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminNotificationsController {
  constructor(private readonly broadcasts: NotificationBroadcastsService) {}

  @Get('broadcasts')
  @RequirePermissions('notifications.send')
  async list(
    @Query(validate(paginationQuerySchema)) query: z.output<typeof paginationQuerySchema>,
  ) {
    return ok(await this.broadcasts.list(query.page, query.pageSize));
  }

  @Post('broadcasts')
  @RequirePermissions('notifications.send')
  @RateLimit({ name: 'notification-broadcast:user', limit: 20, windowSeconds: 3600, by: 'user' })
  async send(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(sendBroadcastSchema)) body: z.output<typeof sendBroadcastSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.broadcasts.send(auth, body, requestMeta(req)));
  }
}
