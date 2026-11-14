import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';


const DEFAULT_PORT = 3100;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? DEFAULT_PORT);
}
await bootstrap();
