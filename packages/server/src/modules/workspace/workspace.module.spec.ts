import { type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from '@rstest/core';

import { createTestingModule } from '../../../test/testing-module.js';

import { LocalWorkspaceFileSearchAdapter } from './adapters/local-workspace-file-search.adapter.js';
import { LocalWorkspaceUploadAdapter } from './adapters/local-workspace-upload.adapter.js';
import { LocalWorkspaceAdapter } from './adapters/local-workspace.adapter.js';
import { IWorkspaceFileSearchPort } from './ports/workspace-file-search.port.js';
import { IWorkspaceUploadPort } from './ports/workspace-upload.port.js';
import { IWorkspacePort } from './ports/workspace.port.js';
import { WorkspaceModule } from './workspace.module.js';


describe('WorkspaceModule', () => {
  it('should compile the module and resolve the workspace port', async () => {
    const module: TestingModule = await createTestingModule({
      imports: [WorkspaceModule],
    }).compile();

    const workspacePort = module.get<IWorkspacePort>(IWorkspacePort);

    expect(workspacePort).toBeInstanceOf(LocalWorkspaceAdapter);
    expect(module.get(IWorkspaceFileSearchPort)).toBeInstanceOf(LocalWorkspaceFileSearchAdapter);
    expect(module.get(IWorkspaceUploadPort)).toBeInstanceOf(LocalWorkspaceUploadAdapter);
  });
});
