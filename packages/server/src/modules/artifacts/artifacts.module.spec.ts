import { type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from '@rstest/core';

import { useTemporaryDataDir } from '../../../test/temporary-data-dir.js';
import { createTestingModule } from '../../../test/testing-module.js';

import { ArtifactsModule } from './artifacts.module.js';
import { IArtifactsPort } from './ports/artifacts.port.js';
import { ArtifactsService } from './services/artifacts.service.js';


describe('ArtifactsModule', () => {
  useTemporaryDataDir();

  it('should compile the module and resolve the artifacts port', async () => {
    const module: TestingModule = await createTestingModule({
      imports: [ArtifactsModule],
    }).compile();

    expect(module.get(IArtifactsPort)).toBeInstanceOf(ArtifactsService);
    await module.close();
  });
});
