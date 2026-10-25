import type { WorkspaceFile } from '../models/workspace-file.model.js';


export interface DelegationContract {
  readonly project?: 'required' | 'optional';
  readonly sessionMode?: 'overridable';
}

export interface IAgentRegistryPort {
  getSystemPrompt(agentRole: string): string;
  getDefaultModel(agentRole: string): string | undefined;
  getDisplayName(agentRole: string): string;
  hasRole(agentRole: string): boolean;
  getDefaultSessionMode(agentRole: string): 'resume' | 'new';
  getDelegationContract(agentRole: string): DelegationContract;
  getTurnReminder(agentRole: string): string;
  isSystemPromptEveryTurn(agentRole: string): boolean;
  getWorkspaceFiles(workspaceDir: string): readonly WorkspaceFile[];
}

export const IAgentRegistryPort = Symbol('IAgentRegistryPort');
