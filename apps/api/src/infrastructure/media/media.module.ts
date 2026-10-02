import { Global, Module } from '@nestjs/common';

import { ImageProcessor } from './image-processor.service';

@Global()
@Module({
  providers: [ImageProcessor],
  exports: [ImageProcessor],
})
export class MediaModule {}
