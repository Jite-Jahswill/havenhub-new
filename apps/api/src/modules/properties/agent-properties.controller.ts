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
  Req,
  UploadedFile,
} from '@nestjs/common';
import {
  AccountType,
  addPropertyVideoSchema,
  createPropertySchema,
  reorderPropertyImagesSchema,
  updatePropertyImageSchema,
  updatePropertySchema,
} from '@havenhub/shared';
import type { Request } from 'express';
import type { z } from 'zod';

import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { ImageUpload, requireFile } from '../../common/upload/image-upload.decorator';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { AgentPropertiesService } from './agent-properties.service';
import { PropertyMediaService } from './property-media.service';

const uuid = new ParseUUIDPipe();

/**
 * The signed-in agent's own properties. There is no agent id in any route:
 * ownership comes from the session, and other agents' ids answer 404.
 */
@Controller('agents/me/properties')
@AccountTypes(AccountType.AGENT)
@RequireVerifiedEmail()
export class AgentPropertiesController {
  constructor(
    private readonly properties: AgentPropertiesService,
    private readonly media: PropertyMediaService,
  ) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext) {
    return ok(await this.properties.list(auth.user.id));
  }

  @Post()
  @RateLimit({ name: 'property-create:user', limit: 30, windowSeconds: 3600, by: 'user' })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createPropertySchema)) body: z.output<typeof createPropertySchema>,
    @Req() req: Request,
  ) {
    return ok(await this.properties.create(auth.user.id, body, requestMeta(req)));
  }

  @Get(':id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return ok(await this.properties.get(auth.user.id, id));
  }

  @Patch(':id')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updatePropertySchema)) body: z.output<typeof updatePropertySchema>,
    @Req() req: Request,
  ) {
    return ok(await this.properties.update(auth.user.id, id, body, requestMeta(req)));
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.properties.submit(auth.user.id, id, requestMeta(req)));
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  async withdraw(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.properties.withdraw(auth.user.id, id, requestMeta(req)));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.properties.archive(auth.user.id, id, requestMeta(req)));
  }

  @Post(':id/feature')
  @HttpCode(HttpStatus.OK)
  async feature(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.properties.feature(auth.user.id, id, requestMeta(req)));
  }

  @Delete(':id/feature')
  async unfeature(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.properties.unfeature(auth.user.id, id, requestMeta(req)));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.properties.restore(auth.user.id, id, requestMeta(req)));
  }

  // ── Media ──

  @Post(':id/images')
  @ImageUpload()
  @RateLimit({ name: 'property-image:user', limit: 120, windowSeconds: 3600, by: 'user' })
  async addImage(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return ok(
      await this.media.addImage(auth.user.id, id, requireFile(file).buffer, requestMeta(req)),
    );
  }

  @Patch(':id/images/order')
  async reorderImages(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(reorderPropertyImagesSchema)) body: z.output<typeof reorderPropertyImagesSchema>,
  ) {
    return ok(await this.media.reorderImages(auth.user.id, id, body.imageIds));
  }

  @Patch(':id/images/:imageId')
  async updateImage(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('imageId', uuid) imageId: string,
    @Body(validate(updatePropertyImageSchema)) body: z.output<typeof updatePropertyImageSchema>,
  ) {
    return ok(await this.media.updateImage(auth.user.id, id, imageId, body));
  }

  @Delete(':id/images/:imageId')
  async deleteImage(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('imageId', uuid) imageId: string,
    @Req() req: Request,
  ) {
    return ok(await this.media.deleteImage(auth.user.id, id, imageId, requestMeta(req)));
  }

  @Post(':id/videos')
  async addVideo(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(addPropertyVideoSchema)) body: z.output<typeof addPropertyVideoSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.media.addVideo(auth.user.id, id, body, requestMeta(req)));
  }

  @Delete(':id/videos/:videoId')
  async deleteVideo(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('videoId', uuid) videoId: string,
  ) {
    return ok(await this.media.deleteVideo(auth.user.id, id, videoId));
  }
}
