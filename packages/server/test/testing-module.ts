import { ConsoleLogger, type LoggerService, type ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';


/** The logger of a test run: silent, or every level with `TEST_LOGS=true`. */
export function createTestLogger(): LoggerService {
  return process.env.TEST_LOGS === 'true' ? new ConsoleLogger() : new ConsoleLogger({ logLevels: [] });
}

/**
 * `Test.createTestingModule` with the logger of the test run. `compile()` installs the builder's logger for every
 * `Logger`, and Nest's default one prints errors.
 */
export function createTestingModule(metadata: ModuleMetadata): TestingModuleBuilder {
  return Test.createTestingModule(metadata).setLogger(createTestLogger());
}
