import { resolve } from 'node:path';

import { Global, Module } from '@nestjs/common';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { LocalStorageDriver } from './drivers/local.driver';
import { S3StorageDriver } from './drivers/s3.driver';
import { MediaController } from './media.controller';
import { StorageService } from './storage.service';
import { STORAGE_DRIVER, type StorageDriver } from './storage.types';

@Global()
@Module({
  controllers: [MediaController],
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [ENV],
      useFactory: (env: Env): StorageDriver =>
        env.STORAGE_DRIVER === 's3'
          ? S3StorageDriver.fromEnv(env)
          : new LocalStorageDriver(
              env.STORAGE_LOCAL_DIR ?? resolve(__dirname, '../../../../../.devdata/uploads'),
            ),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
