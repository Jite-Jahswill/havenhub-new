import {
  Body,
  Controller,
  Delete,
  Get,
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
  adminListExperiencesQuerySchema,
  adminListVacationZonesQuerySchema,
  adminModerateExperienceSchema,
  createVacationZoneSchema,
  setZoneExperiencesSchema,
  updateVacationZoneSchema,
} from '@havenhub/shared';
import type { Request } from 'express';
import type { z } from 'zod';

import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { ImageUpload, requireFile } from '../../common/upload/image-upload.decorator';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  RequirePermissions,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { ExperienceModerationService } from './experience-moderation.service';
import { VacationZonesService } from './vacation-zones.service';

const uuid = new ParseUUIDPipe();
type Out<T extends z.ZodType> = z.output<T>;

@Controller('admin/experiences')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminExperiencesController {
  constructor(private readonly moderation: ExperienceModerationService) {}

  @Get()
  @RequirePermissions('experiences.view')
  async list(
    @Query(validate(adminListExperiencesQuerySchema))
    query: Out<typeof adminListExperiencesQuerySchema>,
  ) {
    return ok(await this.moderation.list(query));
  }

  @Get(':id')
  @RequirePermissions('experiences.view')
  async get(@Param('id', uuid) id: string) {
    return ok(await this.moderation.get(id));
  }

  /** Approve, reject (reason required), suspend (reason required) or restore. Always audited. */
  @Patch(':id/moderation')
  @RequirePermissions('experiences.view', 'experiences.approve')
  async moderate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(adminModerateExperienceSchema))
    body: Out<typeof adminModerateExperienceSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.moderation.moderate(auth, id, body, requestMeta(req)));
  }
}

@Controller('admin/vacation-zones')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
@RequirePermissions('vacation_zones.manage')
export class AdminVacationZonesController {
  constructor(private readonly zones: VacationZonesService) {}

  @Get()
  async list(
    @Query(validate(adminListVacationZonesQuerySchema))
    query: Out<typeof adminListVacationZonesQuerySchema>,
  ) {
    return ok(await this.zones.adminList(query));
  }

  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createVacationZoneSchema)) body: Out<typeof createVacationZoneSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.zones.create(auth.user.id, body, requestMeta(req)));
  }

  @Get(':id')
  async get(@Param('id', uuid) id: string) {
    return ok(await this.zones.adminGet(id));
  }

  @Patch(':id')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updateVacationZoneSchema)) body: Out<typeof updateVacationZoneSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.zones.update(auth.user.id, id, body, requestMeta(req)));
  }

  @Delete(':id')
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.zones.remove(auth.user.id, id, requestMeta(req)));
  }

  @Post(':id/cover')
  @ImageUpload()
  async cover(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return ok(
      await this.zones.setCover(auth.user.id, id, requireFile(file).buffer, requestMeta(req)),
    );
  }

  @Put(':id/experiences')
  async setExperiences(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(setZoneExperiencesSchema)) body: Out<typeof setZoneExperiencesSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.zones.setExperiences(auth.user.id, id, body, requestMeta(req)));
  }
}
