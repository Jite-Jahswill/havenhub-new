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
  Req,
  UploadedFile,
} from '@nestjs/common';
import {
  AccountType,
  addExperienceVideoSchema,
  agentListExperiencesQuerySchema,
  createExperienceSchema,
  createRoomSchema,
  createRoomTypeSchema,
  reorderExperienceImagesSchema,
  replaceTicketTypesSchema,
  replaceTourDatesSchema,
  roomAvailabilityQuerySchema,
  updateExperienceImageSchema,
  updateExperienceSchema,
  updateRoomAvailabilitySchema,
  updateRoomSchema,
  updateRoomTypeSchema,
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
import { AgentExperiencesService } from './agent-experiences.service';
import { ExperienceMediaService } from './experience-media.service';
import { HotelRoomsService } from './hotel-rooms.service';

const uuid = new ParseUUIDPipe();
type Out<T extends z.ZodType> = z.output<T>;

/**
 * The signed-in agent's events, tours, hotels and cleaning services. No agent
 * id in any route: ownership comes from the session, and other agents' ids
 * answer 404. Catalogue only — there is no purchase or booking endpoint.
 */
@Controller('agents/me/experiences')
@AccountTypes(AccountType.AGENT)
@RequireVerifiedEmail()
export class AgentExperiencesController {
  constructor(
    private readonly experiences: AgentExperiencesService,
    private readonly media: ExperienceMediaService,
    private readonly rooms: HotelRoomsService,
  ) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query(validate(agentListExperiencesQuerySchema))
    query: Out<typeof agentListExperiencesQuerySchema>,
  ) {
    return ok(await this.experiences.list(auth.user.id, query.kind));
  }

  @Post()
  @RateLimit({ name: 'experience-create:user', limit: 30, windowSeconds: 3600, by: 'user' })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createExperienceSchema)) body: Out<typeof createExperienceSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.experiences.create(auth.user.id, body, requestMeta(req)));
  }

  @Get(':id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return ok(await this.experiences.get(auth.user.id, id));
  }

  @Patch(':id')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updateExperienceSchema)) body: Out<typeof updateExperienceSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.experiences.update(auth.user.id, id, body, requestMeta(req)));
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.experiences.submit(auth.user.id, id, requestMeta(req)));
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  async withdraw(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.experiences.withdraw(auth.user.id, id, requestMeta(req)));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.experiences.archive(auth.user.id, id, requestMeta(req)));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.experiences.restore(auth.user.id, id, requestMeta(req)));
  }

  // ── Events & tours ──

  @Put(':id/ticket-types')
  async replaceTicketTypes(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(replaceTicketTypesSchema)) body: Out<typeof replaceTicketTypesSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.experiences.replaceTicketTypes(auth.user.id, id, body, requestMeta(req)));
  }

  @Put(':id/tour-dates')
  async replaceTourDates(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(replaceTourDatesSchema)) body: Out<typeof replaceTourDatesSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.experiences.replaceTourDates(auth.user.id, id, body, requestMeta(req)));
  }

  // ── Hotels ──

  @Post(':id/room-types')
  async createRoomType(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(createRoomTypeSchema)) body: Out<typeof createRoomTypeSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.rooms.createRoomType(auth.user.id, id, body, requestMeta(req)));
  }

  @Patch(':id/room-types/:roomTypeId')
  async updateRoomType(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('roomTypeId', uuid) roomTypeId: string,
    @Body(validate(updateRoomTypeSchema)) body: Out<typeof updateRoomTypeSchema>,
    @Req() req: Request,
  ) {
    return ok(
      await this.rooms.updateRoomType(auth.user.id, id, roomTypeId, body, requestMeta(req)),
    );
  }

  @Delete(':id/room-types/:roomTypeId')
  async deleteRoomType(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('roomTypeId', uuid) roomTypeId: string,
    @Req() req: Request,
  ) {
    return ok(await this.rooms.deleteRoomType(auth.user.id, id, roomTypeId, requestMeta(req)));
  }

  @Post(':id/rooms')
  async createRoom(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(createRoomSchema)) body: Out<typeof createRoomSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.rooms.createRoom(auth.user.id, id, body, requestMeta(req)));
  }

  @Patch(':id/rooms/:roomId')
  async updateRoom(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('roomId', uuid) roomId: string,
    @Body(validate(updateRoomSchema)) body: Out<typeof updateRoomSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.rooms.updateRoom(auth.user.id, id, roomId, body, requestMeta(req)));
  }

  @Delete(':id/rooms/:roomId')
  async deleteRoom(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('roomId', uuid) roomId: string,
    @Req() req: Request,
  ) {
    return ok(await this.rooms.deleteRoom(auth.user.id, id, roomId, requestMeta(req)));
  }

  @Get(':id/availability')
  async availability(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Query(validate(roomAvailabilityQuerySchema)) query: Out<typeof roomAvailabilityQuerySchema>,
  ) {
    return ok(await this.rooms.availability(auth.user.id, id, query));
  }

  @Put(':id/rooms/:roomId/availability')
  async setAvailability(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('roomId', uuid) roomId: string,
    @Body(validate(updateRoomAvailabilitySchema)) body: Out<typeof updateRoomAvailabilitySchema>,
    @Req() req: Request,
  ) {
    return ok(await this.rooms.setAvailability(auth.user.id, id, roomId, body, requestMeta(req)));
  }

  // ── Media ──

  @Post(':id/images')
  @ImageUpload()
  @RateLimit({ name: 'experience-image:user', limit: 120, windowSeconds: 3600, by: 'user' })
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
    @Body(validate(reorderExperienceImagesSchema)) body: Out<typeof reorderExperienceImagesSchema>,
  ) {
    return ok(await this.media.reorderImages(auth.user.id, id, body.imageIds));
  }

  @Patch(':id/images/:imageId')
  async updateImage(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('imageId', uuid) imageId: string,
    @Body(validate(updateExperienceImageSchema)) body: Out<typeof updateExperienceImageSchema>,
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
    @Body(validate(addExperienceVideoSchema)) body: Out<typeof addExperienceVideoSchema>,
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
