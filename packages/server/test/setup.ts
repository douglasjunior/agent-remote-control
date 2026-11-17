// `@peculiar/x509` (through tsyringe) needs the Reflect polyfill as soon as it is imported, which can precede Nest's.
import 'reflect-metadata';
import { Logger } from '@nestjs/common';

import { createTestLogger } from './testing-module.js';


Logger.overrideLogger(createTestLogger());
