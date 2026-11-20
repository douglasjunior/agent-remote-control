import { conversationEntrySchema, type ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';

import { LegacyConversationEntryUpgraderService } from './legacy-conversation-entry-upgrader.service.js';


class AuditorRegistry extends AgentRegistryService {
  override listRoles(): string[] {
    return [...super.listRoles(), 'AUDITOR'];
  }

  override getDisplayName(role: string): string {
    return role === 'AUDITOR' ? 'Auditor Agent' : super.getDisplayName(role);
  }
}

const at = '2026-01-01T00:00:00.000Z';
const fallback = { id: 'legacy-7', at: '2026-02-02T00:00:00.000Z' };

describe('LegacyConversationEntryUpgraderService', () => {
  const upgrader = new LegacyConversationEntryUpgraderService(new AgentRegistryService());
  const upgrade = (raw: unknown) => upgrader.upgrade(raw, fallback);
  const notice = (entry: ConversationEntry) => entry as Extract<ConversationEntry, { type: 'notice' }>;

  it.each<ConversationEntry>([
    { id: 'u', at, type: 'user_message', text: 'hi', delivery: 'steered' },
    { id: 'th', at, type: 'thought', text: 'hmm', role: 'DEVELOPER' },
    { id: 'tl', at, type: 'tool', title: 'Read', status: 'completed', role: 'QA' },
    { id: 'd', at, type: 'delegation', delegationId: 'dl', phase: 'steered', round: 1, role: 'QA', roleName: 'QA Agent', summary: 's', prompt: 'p' },
    { id: 'q', at, type: 'question', askerRole: 'QA', askerRoleName: 'QA Agent', text: 'which?', options: [], number: 1, total: 1, closed: false },
    { id: 'a', at, type: 'agent_response', status: 'completed', response: 'done' },
  ])('should pass a valid $type entry through untouched', (entry) => {
    expect(upgrade(entry)).toEqual({ entry, outcome: 'valid' });
  });

  it('should leave a valid entry without the stored prompt of a delegation reading it as empty', () => {
    const raw = { id: 'd', at, type: 'delegation', delegationId: 'dl', phase: 'started', round: 1, role: 'QA', roleName: 'QA Agent', summary: 's' };

    expect(upgrade(raw)).toEqual({ entry: { ...raw, prompt: '' }, outcome: 'valid' });
  });

  it('should turn a steered response without text into an info notice keeping its id and time', () => {
    const raw = { id: 'a1', at, type: 'agent_response', status: 'steered', response: '', agentInfo: { roleName: 'CEO', agentName: 'Claude' } };

    expect(upgrade(raw)).toEqual({
      entry: { id: 'a1', at, type: 'notice', level: 'info', text: 'The CEO took a message into the work in progress.' },
      outcome: 'upgraded',
    });
  });

  it('should keep the text of a steered response that has one by completing it', () => {
    const raw = { id: 'a1', at, type: 'agent_response', status: 'steered', response: 'Looking into it' };

    expect(upgrade(raw)).toEqual({ entry: { id: 'a1', at, type: 'agent_response', status: 'completed', response: 'Looking into it' }, outcome: 'upgraded' });
  });

  it.each(['thought', 'tool'])('should give a %s without a role to the CEO', (type) => {
    const raw = { id: 'x', at, type, text: 'hmm', title: 'Read', status: 'completed', details: 'd' };

    const { entry, outcome } = upgrade(raw);

    expect(outcome).toBe('upgraded');
    expect(entry).toMatchObject({ id: 'x', type, role: 'CEO' });
  });

  it('should keep the role of a thought that has one', () => {
    expect(upgrade({ id: 'x', at, type: 'thought', text: 'hmm', role: 'QA', removed: true })).toEqual({
      entry: { id: 'x', at, type: 'thought', text: 'hmm', role: 'QA', removed: true },
      outcome: 'valid',
    });
  });

  it('should derive the delegation id from the entry id and read a missing summary as empty', () => {
    const raw = { id: 'delegation:1', at, type: 'delegation', phase: 'started', round: 2, role: 'DEVELOPER', roleName: 'Developer Agent', projectName: 'p' };

    expect(upgrade(raw)).toEqual({
      entry: { ...raw, delegationId: 'legacy-delegation:1', summary: '', prompt: '' },
      outcome: 'upgraded',
    });
  });

  it('should keep the summary of a delegation that has one', () => {
    const raw = { id: 'd', at, type: 'delegation', phase: 'finished', round: 1, role: 'QA', roleName: 'QA Agent', summary: 'Testing' };

    expect(upgrade(raw).entry).toMatchObject({ delegationId: 'legacy-d', summary: 'Testing' });
  });

  describe('question', () => {
    const legacyQuestion = (askerRoleName: unknown, extra: object = {}) => ({
      id: 'q', at, type: 'question', askerRoleName, projectName: 'p', text: 'which?', rationale: 'why', options: ['a', 'b'], number: 1, total: 2, message: 'm', ...extra,
    });

    it('should close it and take the asker from the role whose name it carries', () => {
      expect(upgrade(legacyQuestion('Developer Agent'))).toEqual({
        entry: { ...legacyQuestion('Developer Agent'), askerRole: 'DEVELOPER', closed: true },
        outcome: 'upgraded',
      });
    });

    it('should match the name in any letter case, and a role identifier', () => {
      expect(upgrade(legacyQuestion('  qa AGENT ')).entry).toMatchObject({ askerRole: 'QA' });
      expect(upgrade(legacyQuestion('code_reviewer')).entry).toMatchObject({ askerRole: 'CODE_REVIEWER' });
    });

    it('should give a question asked by a name that matches no role to the CEO', () => {
      expect(upgrade(legacyQuestion('Somebody else')).entry).toMatchObject({ askerRole: 'CEO' });
    });

    it('should quote a question that has no asker name at all in a warning notice', () => {
      expect(upgrade(legacyQuestion(42))).toMatchObject({ outcome: 'warning', entry: { id: 'q', type: 'notice', text: expect.stringContaining('It read: which?') } });
    });

    it('should keep the asker and the closed flag it has', () => {
      expect(upgrade(legacyQuestion('Dev', { askerRole: 'QA', closed: false })).outcome).toBe('valid');
      expect(upgrade(legacyQuestion('QA Agent', { askerRole: 'TECH_LEAD' })).entry).toMatchObject({ askerRole: 'TECH_LEAD', closed: true });
      expect(upgrade(legacyQuestion('QA Agent', { closed: false })).entry).toMatchObject({ askerRole: 'QA', closed: false });
    });

    it('should read the asker from the registry rather than from a fixed map', () => {
      const { entry } = new LegacyConversationEntryUpgraderService(new AuditorRegistry()).upgrade(legacyQuestion('Auditor Agent'), fallback);

      expect(entry).toMatchObject({ askerRole: 'AUDITOR' });
    });
  });

  describe('missing identity', () => {
    it('should take the fallback id and time of an entry without them', () => {
      expect(upgrade({ type: 'interim', text: 'wip' })).toEqual({ entry: { ...fallback, type: 'interim', text: 'wip' }, outcome: 'upgraded' });
      expect(upgrade({ id: '', at: 'yesterday', type: 'interim', text: 'wip' }).entry).toMatchObject(fallback);
    });

    it('should write a time given as a date or as milliseconds in ISO format', () => {
      expect(upgrade({ id: 'i', at: '2026-01-01T03:00:00+03:00', type: 'interim', text: 'wip' }).entry).toMatchObject({ at });
      expect(upgrade({ id: 'i', at: Date.parse(at), type: 'interim', text: 'wip' }).entry).toMatchObject({ at });
    });
  });

  describe('warning notice', () => {
    it.each([
      ['an unknown type', { id: 'w', at, type: 'selection', text: 'Pick one' }, 'An entry of type "selection" could not be converted to the current format. It read: Pick one'],
      ['the response', { id: 'w', at, type: 'agent_response', status: 'unknown', response: 'Done' }, 'An entry of type "agent_response" could not be converted to the current format. It read: Done'],
      ['the title', { id: 'w', at, type: 'tool', title: 'Read file', status: 'bogus' }, 'An entry of type "tool" could not be converted to the current format. It read: Read file'],
      ['the message', { id: 'w', at, type: 'skill', message: 'Hello' }, 'An entry of type "skill" could not be converted to the current format. It read: Hello'],
      ['no text', { id: 'w', at, type: 'retry' }, 'An entry of type "retry" could not be converted to the current format.'],
    ])('should stand in for an entry that stays invalid, quoting %s', (_label, raw, text) => {
      expect(upgrade(raw)).toEqual({ entry: { id: 'w', at, type: 'notice', level: 'warning', text }, outcome: 'warning' });
    });

    it('should quote the first human text only, truncated', () => {
      const { entry } = upgrade({ id: 'w', at, type: 'selection', text: 'x'.repeat(500), response: 'later' });

      expect(notice(entry).text).toBe(`An entry of type "selection" could not be converted to the current format. It read: ${'x'.repeat(200)}…`);
    });

    it('should take the fallback id and time when the entry has none', () => {
      expect(upgrade({ type: 'selection', text: 'Pick', at: 'never' }).entry).toEqual({ ...fallback, type: 'notice', level: 'warning', text: expect.stringContaining('"selection"') });
    });

    it.each([[42], ['text'], [null], [[]], [{ id: 'z', at }]])('should stand in for %j as an entry of unknown type', (raw) => {
      const { entry, outcome } = upgrade(raw);

      expect(outcome).toBe('warning');
      expect(notice(entry).text).toContain('"unknown"');
      expect(conversationEntrySchema.safeParse(entry).success).toBe(true);
    });
  });
});
