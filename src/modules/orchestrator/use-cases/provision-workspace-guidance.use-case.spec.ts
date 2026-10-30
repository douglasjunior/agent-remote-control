import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import type { WorkspaceFile } from '../models/workspace-file.model.js';
import type { IAgentRegistryPort } from '../ports/agent-registry.port.js';

import { ProvisionWorkspaceGuidanceUseCase } from './provision-workspace-guidance.use-case.js';


class FakeWorkspacePort implements IWorkspacePort {
  readonly files = new Map<string, string>();
  readonly links = new Map<string, string>();
  readonly ensuredDirectories: string[] = [];

  getBaseDirectory = () => '/ws';
  resolveRepositoryPath = (name: string) => `/ws/${name}`;
  listProjectFolders = async () => [];

  async ensureDirectory(path: string): Promise<void> {
    this.ensuredDirectories.push(path);
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    this.files.set(relativePath, content);
  }

  async ensureSymlink(relativeLinkPath: string, target: string): Promise<void> {
    this.links.set(relativeLinkPath, target);
  }
}

class StubAgentRegistryPort implements IAgentRegistryPort {
  constructor(private readonly files: readonly WorkspaceFile[]) {}

  getSystemPrompt = vi.fn().mockReturnValue('');
  getDefaultModel = vi.fn().mockReturnValue(undefined);
  getDisplayName = vi.fn((role: string) => role);
  hasRole = vi.fn().mockReturnValue(false);
  listRoles = vi.fn().mockReturnValue([]);
  getDefaultSessionMode = vi.fn().mockReturnValue('resume');
  getDelegationContract = vi.fn().mockReturnValue({});
  getTurnReminder = vi.fn().mockReturnValue('');
  isSystemPromptEveryTurn = vi.fn().mockReturnValue(false);
  getWorkspaceFiles = vi.fn((workspaceDir: string) => (workspaceDir === '/ws' ? this.files : []));
}

describe('ProvisionWorkspaceGuidanceUseCase', () => {
  let workspace: FakeWorkspacePort;

  beforeEach(() => {
    workspace = new FakeWorkspacePort();
  });

  function createUseCase(files: readonly WorkspaceFile[]) {
    return new ProvisionWorkspaceGuidanceUseCase(workspace, new StubAgentRegistryPort(files));
  }

  it('should write every guidance file and link the Claude skills folder on module init', async () => {
    await createUseCase([
      { path: 'AGENTS.md', content: 'guide' },
      { path: '.agents/skills/a/SKILL.md', content: 'skill' },
    ]).onModuleInit();

    expect(workspace.ensuredDirectories).toEqual(['/ws']);
    expect(Object.fromEntries(workspace.files)).toEqual({
      'AGENTS.md': 'guide',
      '.agents/skills/a/SKILL.md': 'skill',
    });
    expect(Object.fromEntries(workspace.links)).toEqual({ '.claude/skills': '../.agents/skills' });
  });

  it('should log and swallow failures so the service still starts', async () => {
    workspace.ensureSymlink = vi.fn().mockRejectedValue(new Error('already exists'));

    await expect(createUseCase([]).execute()).resolves.toBeUndefined();
  });

  it('should stringify non-Error failures', async () => {
    workspace.writeFile = vi.fn().mockRejectedValue('disk full');

    await expect(createUseCase([{ path: 'AGENTS.md', content: 'x' }]).execute()).resolves.toBeUndefined();
  });
});
