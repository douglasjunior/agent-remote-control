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
    it('should describe every team member with its delegate tag forms and session mode', () => {
      const skill = contentOf('.agents/skills/agent-team/SKILL.md');

      expect(skill).toContain('### GIT_OPS — Git Ops Agent\nAdds repositories to the workspace.');
      expect(skill).toContain('- Delegate as <delegate role="GIT_OPS"> or <delegate role="GIT_OPS" project="<project-folder>">.');
      expect(skill).toContain('- Runs in "resume" session mode unless you set session="new" or session="resume".');
      expect(skill).toContain('- Modifies files, so no other agent that modifies files');
    });

    it('should put discovery before technical planning and keep requirement interviews with the agents', () => {
      const skill = contentOf('.agents/skills/agent-team/SKILL.md');

      expect(skill).toContain('discovery of what to build before technical planning');
      expect(skill).toContain('Different items, and phases that do not depend on each other, overlap across roles');
      expect(skill).toContain('Do not interview the user about requirements yourself');
    });

    it('should state that no agent is available when the team is empty', () => {
      const [, skill] = buildCeoWorkspaceFiles([], WORKSPACE_DIR);

      expect(skill?.content).toContain('No agents are available for delegation.');
    });
  });

  describe('delegation-protocol skill', () => {
    const skill = contentOf('.agents/skills/delegation-protocol/SKILL.md');

    it('should show valid and invalid project folders', () => {
      expect(skill).toContain('| `project="my-app"` | yes |');
      expect(skill).toContain('| `project="my-app/backend"` | no |');
      expect(skill).toContain(`| \`project="${WORKSPACE_DIR}/my-app"\` | no |`);
    });

    it('should explain parallel delegations and their limits', () => {
      expect(skill).toContain('## Parallel Work');
      expect(skill).toContain('Delegate in one response every task that does not need the output of another task, whatever the roles.');
      expect(skill).toContain('A conversation runs one agent per role at a time, however many projects exist.');
      expect(skill).toContain('A role appears once per response.');
      expect(skill).toContain('<delegate role="DEVELOPER" project="frontend">\nBuild the orders screen');
      expect(skill).toContain('Only one agent that modifies files may work in a project folder at a time, counting agents still running');
      expect(skill).toContain('You get back control as each agent finishes, with its result, including failures');
      expect(skill).toContain('The turn ends with your answer once no agent is left running.');
      expect(skill).toContain('`<agent_result role="ROLE" project="project-folder">...</agent_result>`');
      expect(skill).toContain('`status="failed"` means the agent stopped with an error');
    });

    it('should describe the running agents list and when it is repeated', () => {
      expect(skill).toContain('how long it has been running, whether it is waiting for the user\'s answer and the full task it was given');
      expect(skill).toContain('a prompt without it means the list is the same as the last one you received');
    });

    it('should pipeline several items through different roles', () => {
      expect(skill).toContain('Each response moves every item one stage forward, with a different role per item');
    });

    it('should explain that delegating to a running role replaces its task in any project', () => {
      expect(skill).toContain('Delegating to a role that is already working, in any project, replaces its task with the new specification.');
    });

    it('should choose a new session when the task or subject changes', () => {
      expect(skill).toContain('`session="new"` when the task or subject changes for that agent');
    });

    it('should route access requests through the user and a resumed delegation', () => {
      expect(skill).toContain('## Access Requests');
      expect(skill).toContain(`Paths outside \`${WORKSPACE_DIR}\`, write access, and anything holding secrets`);
      expect(skill).toContain('delegate again to the same agent with `session="resume"`, naming the exact path');
      expect(skill).toContain('ask it with a `<question>` that explains the request and its risk');
    });

    it('should leave the agents questions to the user and hand their documents to the next agent', () => {
      expect(skill).toContain('never repeat its questions to the user or answer them on the user\'s behalf');
      expect(skill).toContain('authorize reading that exact path in the specification of the agent that continues the work');
    });

    it('should authorize reading user attachments handed to an agent', () => {
      expect(skill).toContain('include its absolute path and authorize reading it');
    });
  });

  describe('response-protocol skill', () => {
    const skill = contentOf('.agents/skills/response-protocol/SKILL.md');

    it('should explain attachments with absolute paths converted from agent reports', () => {
      expect(skill).toContain(`<attachment path="${WORKSPACE_DIR}/my-app/docs/report.pdf">Report</attachment>`);
      expect(skill).toContain(`becomes \`${WORKSPACE_DIR}/my-app/docs/report.pdf\``);
      expect(skill).toContain('only in an answer, never in a response that delegates');
    });

    it('should list questions to the user as an outcome that continues the turn', () => {
      expect(skill).toContain('- **Questions**: one or more `<question>` tags');
      expect(skill).toContain('Never combine questions with delegations or attachments.');
      expect(skill).toContain('## Questions to the User\nWhen the work cannot go on without a decision only the user can make');
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
