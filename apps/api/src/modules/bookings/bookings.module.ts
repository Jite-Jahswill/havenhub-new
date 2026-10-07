import { Module } from '@nestjs/common';

import { DiscountsModule } from '../discounts/discounts.module';
import { FinanceModule } from '../finance/finance.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { AdminBookingsController } from './admin-bookings.controller';
import { AgentBookingsController } from './agent-bookings.controller';
import { AvailabilityService } from './availability.service';
import { BookingMaintenanceService } from './booking-maintenance.service';
import { BookingQueriesService } from './booking-queries.service';
import { BookingStateService } from './booking-state.service';
import { BookingDiscoveryController, CustomerBookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [FinanceModule, DiscountsModule, ReviewsModule],
  controllers: [
    BookingDiscoveryController,
    CustomerBookingsController,
    AgentBookingsController,
    AdminBookingsController,
  ],
  providers: [
    AvailabilityService,
    BookingStateService,
    BookingsService,
    BookingQueriesService,
    BookingMaintenanceService,
  ],
  exports: [BookingStateService, BookingsService, BookingQueriesService, BookingMaintenanceService],
})
export class BookingsModule {}
