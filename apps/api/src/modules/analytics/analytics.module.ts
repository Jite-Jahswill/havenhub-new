import { Module } from '@nestjs/common';

import { AdminAnalyticsController, AgentAnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  controllers: [AdminAnalyticsController, AgentAnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
