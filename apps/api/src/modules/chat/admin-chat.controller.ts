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
  Res,
} from '@nestjs/common';
import {
  AccountType,
  adminListConversationsQuerySchema,
  moderateMessageSchema,
  setConversationStatusSchema,
} from '@havenhub/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  RequirePermissions,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { ChatAdminService } from './chat-admin.service';

const uuid = new ParseUUIDPipe();
const beforeQuery = z.object({ before: z.coerce.number().int().min(1).optional() });

/** Support access to conversations: explicit permissions, every read audited. */
@Controller('admin')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminChatController {
  constructor(private readonly chat: ChatAdminService) {}

  @Get('conversations')
  @RequirePermissions('conversations.view')
  async list(
    @Query(validate(adminListConversationsQuerySchema))
    query: z.output<typeof adminListConversationsQuerySchema>,
  ) {
    return ok(await this.chat.list(query));
  }

  @Get('conversations/:id')
  @RequirePermissions('conversations.view')
  async detail(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Query(validate(beforeQuery)) query: z.output<typeof beforeQuery>,
    @Req() req: Request,
  ) {
    return ok(await this.chat.detail(auth.user.id, id, query.before, requestMeta(req)));
  }

  @Get('conversations/:id/attachments/:attachmentId')
  @RequirePermissions('conversations.view')
  async attachment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('attachmentId', uuid) attachmentId: string,
    @Query('variant') variant: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.chat.attachment(auth.user.id, id, attachmentId, variant, res, requestMeta(req));
  }

  @Post('conversations/:id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('conversations.view', 'messages.moderate')
  async setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(setConversationStatusSchema)) body: z.output<typeof setConversationStatusSchema>,
    @Req() req: Request,
  ) {
    return ok(
      await this.chat.setStatus(auth.user.id, id, body.status, body.reason, requestMeta(req)),
    );
  }

  @Post('messages/:id/remove')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('conversations.view', 'messages.moderate')
  async removeMessage(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(moderateMessageSchema)) body: z.output<typeof moderateMessageSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.chat.removeMessage(auth.user.id, id, body.reason, requestMeta(req)));
  }
}
