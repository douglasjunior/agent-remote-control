import { Test, type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { LocalWorkspaceAdapter } from './adapters/local-workspace.adapter.js';
import { SimpleGitAdapter } from './adapters/simple-git.adapter.js';
import { IGitPort } from './ports/git.port.js';
import { IWorkspacePort } from './ports/workspace.port.js';
import { PrepareWorkspaceUseCase } from './use-cases/prepare-workspace.use-case.js';
import { WorkspaceModule } from './workspace.module.js';

describe('WorkspaceModule', () => {
  it('should compile the module and resolve all workspace providers', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [WorkspaceModule],
    }).compile();

    const gitPort = module.get<IGitPort>(IGitPort);
    const workspacePort = module.get<IWorkspacePort>(IWorkspacePort);
    const prepareUseCase = module.get<PrepareWorkspaceUseCase>(
      PrepareWorkspaceUseCase,
    );

    expect(gitPort).toBeInstanceOf(SimpleGitAdapter);
    expect(workspacePort).toBeInstanceOf(LocalWorkspaceAdapter);
    expect(prepareUseCase).toBeInstanceOf(PrepareWorkspaceUseCase);
  });
});
