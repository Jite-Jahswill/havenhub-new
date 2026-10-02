import { Module } from '@nestjs/common';

import { AdminAmenitiesController, AmenitiesController } from './amenities.controller';
import { AmenitiesService } from './amenities.service';

@Module({
  controllers: [AmenitiesController, AdminAmenitiesController],
  providers: [AmenitiesService],
})
export class AmenitiesModule {}
