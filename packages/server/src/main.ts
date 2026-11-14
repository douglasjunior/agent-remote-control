import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { IAppLoggerPort } from './modules/logging/ports/app-logger.port.js';
import { WebStaticAssetsService } from './modules/web/services/web-static-assets.service.js';


async function bootstrap() {
  const logger = new Logger('Process');
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    logger.error(`unhandled_rejection: ${message}`);
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get<IAppLoggerPort>(IAppLoggerPort));
  if (process.env.WEB_ENABLED !== 'false') {
    app.get(WebStaticAssetsService).register(app);
  }
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
