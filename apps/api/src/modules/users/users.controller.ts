import { Body, Controller, Delete, Get, Patch, Post, UploadedFile } from '@nestjs/common';
import { updateMyProfileSchema } from '@havenhub/shared';
import type { z } from 'zod';

import { ok } from '../../common/http/response';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { ImageUpload, requireFile } from '../../common/upload/image-upload.decorator';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from '../auth/auth.service';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators/auth.decorators';
import { UsersService } from './users.service';

/** The caller's own account. There is deliberately no `/users/:id` for non-admins. */
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Get('me')
  async me(@CurrentAuth() auth: AuthContext) {
    return ok(await this.auth.authUser(auth.user.id));
  }

  @Patch('me')
  async updateMe(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(updateMyProfileSchema)) body: z.output<typeof updateMyProfileSchema>,
  ) {
    return ok(await this.users.updateMe(auth.user.id, body));
  }

  @Post('me/avatar')
  @ImageUpload()
  @RateLimit({ name: 'avatar:user', limit: 20, windowSeconds: 3600, by: 'user' })
  async uploadAvatar(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return ok(await this.users.setAvatar(auth.user.id, requireFile(file).buffer));
  }

  @Delete('me/avatar')
  async removeAvatar(@CurrentAuth() auth: AuthContext) {
    return ok(await this.users.removeAvatar(auth.user.id));
  }
}
