import { Module } from '@nestjs/common';

import { PropertyAccessService } from '../properties/property-access.service';
import { AdminDiscountsController, AgentPromoCodesController } from './discounts.controller';
import { DiscountsService } from './discounts.service';

/** Discount codes: plan codes (administrators) and agents' promo codes for bookings. */
@Module({
  controllers: [AdminDiscountsController, AgentPromoCodesController],
  providers: [DiscountsService, PropertyAccessService],
  exports: [DiscountsService],
})
export class DiscountsModule {}
