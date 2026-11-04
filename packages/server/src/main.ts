import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { parseAllowedOrigins } from './modules/web/utils/web-origin.util.js';


async function bootstrap() {
  const logger = new Logger('Process');
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    logger.error(`unhandled_rejection: ${message}`);
  });

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: [...parseAllowedOrigins(process.env.WEB_ALLOWED_ORIGINS)] });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
