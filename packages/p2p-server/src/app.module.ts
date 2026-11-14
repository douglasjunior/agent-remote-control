import { Module } from '@nestjs/common';

import { AppController } from './app.controller.js';
import { SignalingModule } from './modules/signaling/signaling.module.js';
import { WebAppModule } from './modules/web-app/web-app.module.js';


@Module({
  imports: [SignalingModule, WebAppModule],
  controllers: [AppController],
})
export class AppModule {}
