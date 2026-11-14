import type { AgentDefinition } from './agent-definition.model.js';


/** What a skill's content may depend on: the team of the role reading it and the workspaces root. */
export interface SkillContext {
  readonly team: readonly AgentDefinition[];
  readonly workspaceDir: string;
}

/** A skill and the roles that may read it, built-in or the user's own; its content is built when it is read. */
export interface AgentSkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly roles: readonly string[];
  buildContent(context: SkillContext): string;
}
