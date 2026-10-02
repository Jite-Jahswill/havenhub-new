import { Controller, Delete, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { AccountType, paginationQuerySchema } from '@havenhub/shared';
import type { z } from 'zod';

import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.types';
import { AccountTypes, CurrentAuth } from '../auth/decorators/auth.decorators';
import { FavoritesService } from './favorites.service';

/** The signed-in customer's favourites. No route accepts another user's id. */
@Controller('favorites')
@AccountTypes(AccountType.CUSTOMER)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query(validate(paginationQuerySchema)) query: z.output<typeof paginationQuerySchema>,
  ) {
    return ok(await this.favorites.list(auth.user.id, query.page, query.pageSize));
  }

  @Put(':propertyId')
  async add(
    @CurrentAuth() auth: AuthContext,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    await this.favorites.add(auth.user.id, propertyId);
    return ok({ propertyId, favorited: true });
  }

  @Delete(':propertyId')
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    await this.favorites.remove(auth.user.id, propertyId);
    return ok({ propertyId, favorited: false });
  }
}
