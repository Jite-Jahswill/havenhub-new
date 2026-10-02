import { Module } from '@nestjs/common';

import { AgentsModule } from '../agents/agents.module';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [UsersModule, AgentsModule],
  controllers: [AdminController],
})
export class AdminModule {}
