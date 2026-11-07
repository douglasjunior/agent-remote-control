import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';


const SKILLS_LINK = { path: '.claude/skills', target: '../.agents/skills' } as const;

/** Runs before the channels connect, so the first turn already finds the guidance on disk. */
@Injectable()
export class ProvisionWorkspaceGuidanceUseCase implements OnModuleInit {
  private readonly logger = new Logger(ProvisionWorkspaceGuidanceUseCase.name);

  constructor(
    @Inject(IWorkspacePort)
    private readonly workspacePort: IWorkspacePort,
    @Inject(IAgentRegistryPort)
    private readonly agentRegistry: IAgentRegistryPort,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.execute();
  }

  /** A failure is only logged: the instructions sent with every prompt still keep agents working. */
  async execute(): Promise<void> {
    const baseDirectory = this.workspacePort.getBaseDirectory();
    try {
      await this.workspacePort.ensureDirectory(baseDirectory);
      const files = this.agentRegistry.getWorkspaceFiles(baseDirectory);
      for (const file of files) {
        await this.workspacePort.writeFile(file.path, file.content);
      }
      await this.workspacePort.ensureSymlink(SKILLS_LINK.path, SKILLS_LINK.target);
      this.logger.log(`[Workspace Guidance] Wrote ${files.length} file(s) to ${baseDirectory}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Workspace Guidance Failed] ${baseDirectory}: ${message}`);
    }
  }
}
