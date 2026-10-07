import { Module } from '@nestjs/common';

import { ConfigModule } from './config/config.module';
import { CryptoModule } from './infrastructure/crypto/crypto.module';
import { MailModule } from './infrastructure/mail/mail.module';
import { MediaModule } from './infrastructure/media/media.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { AdminModule } from './modules/admin/admin.module';
import { AgentsModule } from './modules/agents/agents.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AmenitiesModule } from './modules/amenities/amenities.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { ChatModule } from './modules/chat/chat.module';
import { FinanceModule } from './modules/finance/finance.module';
import { HealthModule } from './modules/health/health.module';
import { BadgesModule } from './modules/badges/badges.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PlatformCoreModule } from './modules/platform/platform-core.module';
import { PlatformModule } from './modules/platform/platform.module';
import { PlansModule } from './modules/plans/plans.module';
import { CmsModule } from './modules/cms/cms.module';
import { ExperiencesModule } from './modules/experiences/experiences.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { UsersModule } from './modules/users/users.module';

/**
 * Root module. Infrastructure modules are global; each business domain is
 * its own module under `src/modules`.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    CryptoModule,
    MailModule,
    StorageModule,
    MediaModule,
    AuditModule,
    PlatformCoreModule,
    PlansModule,
    RbacModule,
    AuthModule,
    UsersModule,
    AgentsModule,
    AdminModule,
    AmenitiesModule,
    PropertiesModule,
    ExperiencesModule,
    CmsModule,
    PlatformModule,
    AnalyticsModule,
    FinanceModule,
    BookingsModule,
    PaymentsModule,
    SubscriptionsModule,
    RealtimeModule,
    NotificationsModule,
    BadgesModule,
    ReviewsModule,
    ChatModule,
    HealthModule,
  ],
})
export class AppModule {}
