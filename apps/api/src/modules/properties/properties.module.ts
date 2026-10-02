import { Module } from '@nestjs/common';

import { AdminPropertiesController } from './admin-properties.controller';
import { AgentPropertiesController } from './agent-properties.controller';
import { AgentPropertiesService } from './agent-properties.service';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { PropertyAccessService } from './property-access.service';
import { PropertyMediaService } from './property-media.service';
import { PropertyModerationService } from './property-moderation.service';
import { PropertySearchService } from './property-search.service';
import { PublicPropertiesController } from './public-properties.controller';

@Module({
  controllers: [
    PublicPropertiesController,
    AgentPropertiesController,
    FavoritesController,
    AdminPropertiesController,
  ],
  providers: [
    PropertyAccessService,
    AgentPropertiesService,
    PropertyMediaService,
    PropertySearchService,
    PropertyModerationService,
    FavoritesService,
  ],
})
export class PropertiesModule {}
