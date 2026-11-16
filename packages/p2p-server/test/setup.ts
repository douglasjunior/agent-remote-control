import { Logger } from '@nestjs/common';

import { createTestLogger } from './testing-module.js';


Logger.overrideLogger(createTestLogger());
