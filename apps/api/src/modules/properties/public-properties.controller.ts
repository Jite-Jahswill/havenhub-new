import {
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
import { propertySearchQuerySchema } from '@havenhub/shared';
import type { Request } from 'express';
import type { z } from 'zod';

import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import type { AuthContext } from '../auth/auth.types';
import { OptionalAuth, Public, SkipCsrf } from '../auth/decorators/auth.decorators';
import { PropertySearchService } from './property-search.service';

const SLUG = /^[a-z0-9-]{3,160}$/;

/** Public discovery: only published listings of verified, active agents. */
@Public()
@Controller('properties')
export class PublicPropertiesController {
  constructor(private readonly search: PropertySearchService) {}

  @Get()
  @RateLimit({ name: 'search:ip', limit: 240, windowSeconds: 60, by: 'ip' })
  async list(
    @Query(validate(propertySearchQuerySchema)) query: z.output<typeof propertySearchQuerySchema>,
    @OptionalAuth() viewer: AuthContext | undefined,
  ) {
    return ok(await this.search.search(query, viewer));
  }

  @Get(':slug')
  async detail(@Param('slug') slug: string, @OptionalAuth() viewer: AuthContext | undefined) {
    return ok(await this.search.detail(validSlug(slug), viewer));
  }

  @Get(':slug/similar')
  async similar(@Param('slug') slug: string) {
    return ok(await this.search.similar(validSlug(slug)));
  }

  /** Fire-and-forget view beacon; de-duplicated per visitor. */
  @Post(':id/views')
  @SkipCsrf()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ name: 'views:ip', limit: 120, windowSeconds: 60, by: 'ip' })
  async view(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    await this.search.recordView(id, `${req.ip ?? ''}|${req.get('user-agent') ?? ''}`);
    return ok({ recorded: true });
  }
}

function validSlug(slug: string): string {
  // Anything that is not a well-formed slug cannot exist; answer like any missing property.
  return SLUG.test(slug) ? slug : '__invalid__';
}
