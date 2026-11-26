import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { loadEnvironment } from './env-config.js';
import { DatabaseModule } from './modules/database/database.module.js';


/** Imports the legacy JSON files of `DATA_DIR` without starting the server, as its boot would. */
@Module({
  imports: [loadEnvironment(), DatabaseModule],
})
class MigrateLegacyModule {}

const app = await NestFactory.createApplicationContext(MigrateLegacyModule);
await app.close();
