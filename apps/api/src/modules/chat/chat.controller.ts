import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
} from '@nestjs/common';
import {
  AccountType,
  archiveConversationSchema,
  editMessageSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  markConversationReadSchema,
  reactionSchema,
  sendMessageSchema,
  startConversationSchema,
  type StartConversationInput,
} from '@havenhub/shared';
import type { Response } from 'express';
import type { z } from 'zod';

import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { requireFile } from '../../common/upload/image-upload.decorator';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { AttachmentsService } from './attachments.service';
import { ChatUpload } from './chat-upload.decorator';
import { ConversationsService } from './conversations.service';
import { MessagesService } from './messages.service';

const uuid = new ParseUUIDPipe();

/**
 * Customers' and agents' own conversations. Every route resolves the caller
 * as a participant first; anything else is "not found".
 */
@Controller()
@AccountTypes(AccountType.CUSTOMER, AccountType.AGENT)
@RequireVerifiedEmail()
export class ChatController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Get('conversations')
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query(validate(listConversationsQuerySchema))
    query: z.output<typeof listConversationsQuerySchema>,
  ) {
    return ok(await this.conversations.list(auth.user.id, query));
  }

  /** Get-or-create: returns the existing conversation for this context if there is one. */
  @Post('conversations')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'conversation-start:user', limit: 30, windowSeconds: 3600, by: 'user' })
  async start(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(startConversationSchema)) body: StartConversationInput,
  ) {
    return ok(await this.conversations.start(auth, body));
  }

  @Get('conversations/unread')
  async unread(@CurrentAuth() auth: AuthContext) {
    return ok(await this.conversations.unreadSummary(auth.user.id));
  }

  @Get('conversations/:id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return ok(await this.conversations.get(auth.user.id, id));
  }

  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.OK)
  async read(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(markConversationReadSchema)) body: z.output<typeof markConversationReadSchema>,
  ) {
    return ok(await this.conversations.markRead(auth.user.id, id, body.seq));
  }

  @Post('conversations/:id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(archiveConversationSchema)) body: z.output<typeof archiveConversationSchema>,
  ) {
    return ok(await this.conversations.archive(auth.user.id, id, body.archived));
  }

  @Get('conversations/:id/messages')
  async messagesPage(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Query(validate(listMessagesQuerySchema)) query: z.output<typeof listMessagesQuerySchema>,
  ) {
    return ok(await this.messages.list(auth.user.id, id, query));
  }

  /**
   * Idempotent on `clientKey`: a retry returns the original message
   * (200) instead of creating another (201).
   */
  @Post('conversations/:id/messages')
  @RateLimit({ name: 'message-send:user', limit: 60, windowSeconds: 60, by: 'user' })
  async send(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(sendMessageSchema)) body: z.output<typeof sendMessageSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { message, created } = await this.messages.send(auth.user.id, id, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return ok(message);
  }

  @Post('conversations/:id/attachments')
  @ChatUpload()
  @RateLimit({ name: 'chat-upload:user', limit: 40, windowSeconds: 600, by: 'user' })
  async upload(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return ok(await this.attachments.upload(auth.user.id, id, requireFile(file)));
  }

  @Get('conversations/:id/attachments/:attachmentId')
  async download(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('attachmentId', uuid) attachmentId: string,
    @Query('variant') variant: string | undefined,
    @Res() res: Response,
  ) {
    await this.attachments.download(auth.user.id, id, attachmentId, variant, res);
  }

  @Patch('messages/:id')
  async edit(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(editMessageSchema)) body: z.output<typeof editMessageSchema>,
  ) {
    return ok(await this.messages.edit(auth.user.id, id, body.body));
  }

  @Delete('messages/:id')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return ok(await this.messages.remove(auth.user.id, id));
  }

  @Put('messages/:id/reaction')
  @RateLimit({ name: 'message-react:user', limit: 120, windowSeconds: 60, by: 'user' })
  async react(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(reactionSchema)) body: z.output<typeof reactionSchema>,
  ) {
    return ok(await this.messages.react(auth.user.id, id, body.emoji));
  }

  @Delete('messages/:id/reaction')
  async unreact(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return ok(await this.messages.unreact(auth.user.id, id));
  }
}
