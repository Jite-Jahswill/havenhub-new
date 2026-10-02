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
import { AmenitiesModule } from './modules/amenities/amenities.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { FinanceModule } from './modules/finance/finance.module';
import { HealthModule } from './modules/health/health.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PlansModule } from './modules/plans/plans.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { RbacModule } from './modules/rbac/rbac.module';
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
    PlansModule,
    RbacModule,
    AuthModule,
    UsersModule,
    AgentsModule,
    AdminModule,
    AmenitiesModule,
    PropertiesModule,
    FinanceModule,
    BookingsModule,
    PaymentsModule,
    HealthModule,
  ],
})
export class AppModule {}
