import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  experienceSearchQuerySchema,
  roomAvailabilityQuerySchema,
  vacationZoneListQuerySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { Public } from '../auth/decorators/auth.decorators';
import { ExperienceSearchService } from './experience-search.service';
import { VacationZonesService } from './vacation-zones.service';

const SLUG = /^[a-z0-9-]{3,160}$/;
type Out<T extends z.ZodType> = z.output<T>;

/** Anything that is not a well-formed slug cannot exist; answer like any missing listing. */
const validSlug = (slug: string) => (SLUG.test(slug) ? slug : '__invalid__');

/** Public discovery: only published listings of verified, active agents. */
@Public()
@Controller('experiences')
export class PublicExperiencesController {
  constructor(private readonly search: ExperienceSearchService) {}

  @Get()
  @RateLimit({ name: 'search:ip', limit: 240, windowSeconds: 60, by: 'ip' })
  async list(
    @Query(validate(experienceSearchQuerySchema)) query: Out<typeof experienceSearchQuerySchema>,
  ) {
    return ok(await this.search.search(query));
  }

  @Get(':slug')
  async detail(@Param('slug') slug: string) {
    return ok(await this.search.detail(validSlug(slug)));
  }

  /** Hotels only: open rooms per type and date (catalogue information). */
  @Get(':slug/availability')
  @RateLimit({ name: 'search:ip', limit: 240, windowSeconds: 60, by: 'ip' })
  async availability(
    @Param('slug') slug: string,
    @Query(validate(roomAvailabilityQuerySchema)) query: Out<typeof roomAvailabilityQuerySchema>,
  ) {
    return ok(await this.search.hotelAvailability(validSlug(slug), query));
  }
}

/** Published destination pages (§23). */
@Public()
@Controller('vacation-zones')
export class PublicVacationZonesController {
  constructor(private readonly zones: VacationZonesService) {}

  @Get()
  @RateLimit({ name: 'search:ip', limit: 240, windowSeconds: 60, by: 'ip' })
  async list(
    @Query(validate(vacationZoneListQuerySchema)) query: Out<typeof vacationZoneListQuerySchema>,
  ) {
    return ok(await this.zones.list(query));
  }

  @Get(':slug')
  async detail(@Param('slug') slug: string) {
    return ok(await this.zones.detail(validSlug(slug)));
  }
}
