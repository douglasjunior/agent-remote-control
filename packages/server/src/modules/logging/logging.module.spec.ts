import { useTemporaryDataDir } from '../../../test/temporary-data-dir.js';
import { createTestingModule } from '../../../test/testing-module.js';

import { FileConsoleLoggerAdapter } from './adapters/file-console-logger.adapter.js';
import { LoggingModule } from './logging.module.js';
import { IAppLoggerPort } from './ports/app-logger.port.js';


describe('LoggingModule', () => {
  useTemporaryDataDir();

  it('should provide the file logger', async () => {
    const module = await createTestingModule({ imports: [LoggingModule] }).compile();

    expect(module.get(IAppLoggerPort)).toBeInstanceOf(FileConsoleLoggerAdapter);
    await module.close();
  });
});
