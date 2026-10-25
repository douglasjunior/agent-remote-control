import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from '../models/agent-definition.model.js';

import { buildCeoWorkspaceFiles } from './ceo-workspace-files.prompt.js';


const WORKSPACE_DIR = '/home/user/workspaces';

const gitOps: AgentDefinition = {
  role: 'GIT_OPS',
  name: 'Git Ops Agent',
  description: 'Adds repositories to the workspace.',
  buildSystemPrompt: () => 'git',
  delegation: { project: 'optional', sessionMode: 'overridable' },
};

const files = buildCeoWorkspaceFiles([gitOps], WORKSPACE_DIR);
const contentOf = (path: string) => files.find(file => file.path === path)?.content ?? '';

describe('ceo-workspace-files.prompt', () => {
  it('should build AGENTS.md and one SKILL.md per CEO skill', () => {
    expect(files.map(file => file.path)).toEqual([
      'AGENTS.md',
      '.agents/skills/agent-team/SKILL.md',
      '.agents/skills/delegation-protocol/SKILL.md',
      '.agents/skills/response-protocol/SKILL.md',
      '.agents/skills/workspace-navigation/SKILL.md',
    ]);
  });

  it('should give every skill a frontmatter whose name matches its folder', () => {
    for (const file of files.filter(item => item.path.endsWith('SKILL.md'))) {
      const folder = file.path.split('/').at(-2);
      expect(file.content.startsWith(`---\nname: ${folder}\ndescription: `)).toBe(true);
    }
  });

  describe('AGENTS.md', () => {
    const agentsMd = contentOf('AGENTS.md');

    it('should describe the workspace with its absolute path and the safety rules', () => {
      expect(agentsMd).toContain(`This directory (\`${WORKSPACE_DIR}\`) is a multi-project container`);
      expect(agentsMd).toContain('get explicit confirmation before taking any action or authorizing an agent to do it');
      expect(agentsMd).toContain('Follow them silently');
    });

    it('should warn that the files are regenerated on every start', () => {
      expect(agentsMd).toContain('regenerates them on every start');
    });

    it('should not index the skills, which are discovered by their own description', () => {
      expect(agentsMd).not.toContain('SKILL.md');
    });
  });

  describe('agent-team skill', () => {
    it('should describe every team member with its marker forms and session mode', () => {
      const skill = contentOf('.agents/skills/agent-team/SKILL.md');

      expect(skill).toContain('### GIT_OPS — Git Ops Agent\nAdds repositories to the workspace.');
      expect(skill).toContain('- Delegate as [DELEGATE:GIT_OPS] or [DELEGATE:GIT_OPS:<project-folder>].');
      expect(skill).toContain('- Runs in "resume" session mode unless you append :new or :resume.');
    });

    it('should state that no agent is available when the team is empty', () => {
      const [, skill] = buildCeoWorkspaceFiles([], WORKSPACE_DIR);

      expect(skill?.content).toContain('No agents are available for delegation.');
    });
  });

  describe('delegation-protocol skill', () => {
    const skill = contentOf('.agents/skills/delegation-protocol/SKILL.md');

    it('should show valid and invalid project folders', () => {
      expect(skill).toContain('| `[DELEGATE:ROLE:my-app]` | yes |');
      expect(skill).toContain('| `[DELEGATE:ROLE:my-app/backend]` | no |');
      expect(skill).toContain(`| \`[DELEGATE:ROLE:${WORKSPACE_DIR}/my-app]\` | no |`);
    });

    it('should choose a new session when the task or subject changes', () => {
      expect(skill).toContain('`:new` when the task or subject changes for that agent');
    });

    it('should route access requests through the user and a resumed delegation', () => {
      expect(skill).toContain('## Access Requests');
      expect(skill).toContain(`Paths outside \`${WORKSPACE_DIR}\`, write access, and anything holding secrets`);
      expect(skill).toContain('delegate again to the same agent with `:resume`, naming the exact path');
    });

    it('should authorize reading user attachments handed to an agent', () => {
      expect(skill).toContain('include its absolute path and authorize reading it');
    });
  });

  describe('response-protocol skill', () => {
    const skill = contentOf('.agents/skills/response-protocol/SKILL.md');

    it('should explain attachments with absolute paths converted from agent reports', () => {
      expect(skill).toContain('![short description](file:///absolute/path/to/image.png)');
      expect(skill).toContain(`becomes \`file://${WORKSPACE_DIR}/my-app/docs/report.pdf\``);
    });
  });

  describe('workspace-navigation skill', () => {
    const skill = contentOf('.agents/skills/workspace-navigation/SKILL.md');

    it('should let the CEO read the manifest but never write it', () => {
      expect(skill).toContain('workspace-manifest.json');
      expect(skill).toContain('Read it to answer whether a repository is already in the workspace');
      expect(skill).toContain('Never write it.');
    });

    it('should match repository URLs regardless of protocol form', () => {
      expect(skill).toContain('`https://host/group/repo` and `git@host:group/repo` are the same repository');
    });
  });
});
