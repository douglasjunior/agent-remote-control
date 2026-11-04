import { Test, type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { LocalWorkspaceAdapter } from './adapters/local-workspace.adapter.js';
import { IWorkspacePort } from './ports/workspace.port.js';
import { WorkspaceModule } from './workspace.module.js';


describe('WorkspaceModule', () => {
  it('should compile the module and resolve the workspace port', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [WorkspaceModule],
    }).compile();

    const workspacePort = module.get<IWorkspacePort>(IWorkspacePort);

    expect(workspacePort).toBeInstanceOf(LocalWorkspaceAdapter);
  });
});
