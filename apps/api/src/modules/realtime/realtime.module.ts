import { Global, Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RealtimeTicketsService } from './realtime-tickets.service';
import { RealtimeController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';

/** Socket.IO delivery for any feature (chat today; notifications later). */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [RealtimeController],
  providers: [RealtimeGateway, RealtimeTicketsService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
