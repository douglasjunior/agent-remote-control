import { Module } from '@nestjs/common';

import { PathsModule } from '../paths/paths.module.js';
import { StorageModule } from '../storage/storage.module.js';

import { AccessTokenService } from './services/access-token.service.js';


@Module({
  imports: [PathsModule, StorageModule],
  providers: [AccessTokenService],
  exports: [AccessTokenService],
})
export class AccessTokenModule {}
