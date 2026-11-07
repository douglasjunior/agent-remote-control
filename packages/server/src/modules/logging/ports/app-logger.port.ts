import type { LoggerService } from '@nestjs/common';


/**
 * The logger the application runs on, installed with `app.useLogger`. Code logs through Nest's `Logger`, so changing
 * the provider bound to this symbol changes where every log goes.
 */
export const IAppLoggerPort = Symbol('IAppLoggerPort');
export type IAppLoggerPort = LoggerService;
