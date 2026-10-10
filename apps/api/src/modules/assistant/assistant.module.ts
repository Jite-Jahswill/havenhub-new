import { Module } from '@nestjs/common';

import { ChatModule } from '../chat/chat.module';
import { ExperiencesModule } from '../experiences/experiences.module';
import { PropertiesModule } from '../properties/properties.module';
import { AdminAssistantController, AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [PropertiesModule, ExperiencesModule, ChatModule],
  controllers: [AssistantController, AdminAssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
