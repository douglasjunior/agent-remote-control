import { describe, expect, it } from 'vitest';

import { DELEGATION_PROTOCOL_SKILL } from './delegation-protocol.skill.js';


const WORKSPACE_DIR = '/home/user/workspaces';

describe('delegation-protocol skill', () => {
  const skill = DELEGATION_PROTOCOL_SKILL.buildContent({ team: [], workspaceDir: WORKSPACE_DIR });

  it('should be read by the CEO only', () => {
    expect(DELEGATION_PROTOCOL_SKILL).toMatchObject({ name: 'delegation-protocol', roles: ['CEO'] });
  });

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
    expect(skill).toContain('<delegate role="DEVELOPER" summary="Building the orders screen" artifact="T-7">\nImplement T-7.');
    expect(skill).toContain('Only one agent that modifies files may work in a project folder at a time, counting agents still running');
    expect(skill).toContain('You get back control as each agent finishes, with its result, including failures');
    expect(skill).toContain('The turn ends with your answer once no agent is left running.');
    expect(skill).toContain('`<agent_result role="ROLE" project="project-folder" artifact="T-3" artifact_status="in_review" agent="coding-agent" model="model" effort="effort">...</agent_result>`');
    expect(skill).toContain('are the coding agent, model and effort that ran it, `default` when none was set');
    expect(skill).toContain('`status="failed"` means the agent stopped with an error');
  });

  it('should describe the team profiles and when they are repeated', () => {
    expect(skill).toContain('lists every agent of your team with its role, coding agent, model and effort, and whether it is idle or working');
    expect(skill).toContain('how long it has been running, whether it is waiting for the user\'s answer and the summary of its task');
    expect(skill).toContain('a prompt without it means it is the same as the last one you received');
    expect(skill).toContain('`[PREVIOUS_TURN]` reports how your last turn ended');
  });

  it('should ask for the context to be restated when the coding agent of a role changed', () => {
    expect(skill).toContain('differs from the one in the last `[TEAM_PROFILES]` you received');
    expect(skill).toContain('restate the goal, the current state of the work');
    expect(skill).toContain('A change of model or effort alone keeps the session');
  });

  it('should route work on an artifact through the artifact attribute instead of its content', () => {
    expect(skill).toContain('The artifact replaces the content you would copy into the specification');
    expect(skill).toContain('With `artifact`, the agent holds that artifact while it runs, receives its content');
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
