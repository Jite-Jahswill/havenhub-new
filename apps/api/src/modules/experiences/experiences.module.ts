import { Module } from '@nestjs/common';

import { PropertyAccessService } from '../properties/property-access.service';
import {
  AdminExperiencesController,
  AdminVacationZonesController,
} from './admin-experiences.controller';
import { AgentExperiencesController } from './agent-experiences.controller';
import { AgentExperiencesService } from './agent-experiences.service';
import { ExperienceAccessService } from './experience-access.service';
import { ExperienceMediaService } from './experience-media.service';
import { ExperienceModerationService } from './experience-moderation.service';
import { ExperienceSearchService } from './experience-search.service';
import { HotelRoomsService } from './hotel-rooms.service';
import {
  PublicExperiencesController,
  PublicVacationZonesController,
} from './public-experiences.controller';
import { VacationZonesService } from './vacation-zones.service';

/**
 * Phase 6: events, tours, hotels, cleaning services and vacation zones —
 * catalogue and moderation only. Purchasing, booking and payment for these
 * kinds are deliberately absent until their business rules are defined.
 */
@Module({
  controllers: [
    PublicExperiencesController,
    PublicVacationZonesController,
    AgentExperiencesController,
    AdminExperiencesController,
    AdminVacationZonesController,
  ],
  providers: [
    PropertyAccessService,
    ExperienceAccessService,
    AgentExperiencesService,
    ExperienceMediaService,
    HotelRoomsService,
    ExperienceModerationService,
    ExperienceSearchService,
    VacationZonesService,
  ],
  // The CMS homepage shows public listings through these, unchanged.
  exports: [ExperienceSearchService, VacationZonesService],
})
export class ExperiencesModule {}
