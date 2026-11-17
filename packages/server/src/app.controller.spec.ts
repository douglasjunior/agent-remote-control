import type { TestingModule } from '@nestjs/testing';

import { createTestingModule } from '../test/testing-module.js';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';


describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should report the application as healthy', () => {
      expect(appController.getHealth()).toEqual({ status: 'ok' });
    });
  });
});
