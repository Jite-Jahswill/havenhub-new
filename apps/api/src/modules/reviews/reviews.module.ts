import { Module } from '@nestjs/common';

import { CmsModule } from '../cms/cms.module';
import {
  AdminReviewsController,
  CustomerReviewsController,
  PublicReviewsController,
} from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [CmsModule],
  controllers: [PublicReviewsController, CustomerReviewsController, AdminReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
