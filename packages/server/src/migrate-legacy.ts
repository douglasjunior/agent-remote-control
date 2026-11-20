import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { DatabaseModule } from './modules/database/database.module.js';
import { resolveFromRepositoryRoot } from './repository-root.util.js';


/** Imports the legacy JSON files of `DATA_DIR` without starting the server, as its boot would. */
@Module({
  imports: [ConfigModule.forRoot({ envFilePath: resolveFromRepositoryRoot('.env'), expandVariables: true }), DatabaseModule],
})
class MigrateLegacyModule {}

const app = await NestFactory.createApplicationContext(MigrateLegacyModule);
await app.close();
