import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { IAppLoggerPort } from './modules/logging/ports/app-logger.port.js';


async function bootstrap() {
  const logger = new Logger('Process');
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    logger.error(`unhandled_rejection: ${message}`);
  });

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get<IAppLoggerPort>(IAppLoggerPort));
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
