import type { SkillContext } from '../models/agent-skill-definition.model.js';


export function skillContext(overrides: Partial<SkillContext> = {}): SkillContext {
  return { team: [], artifacts: { scope: 'task', sections: [], fields: [] }, rolePrompt: 'role prompt', agentInterface: 'tags', workspaceDir: '/ws', ...overrides };
}
