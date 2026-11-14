import { conversationEntrySchema } from '@agent-remote-control/protocol/conversation-entry';

import type { QuestionPrompt } from '../../orchestrator/models/user-question.model.js';

import { ConversationEntryService } from './conversation-entry.service.js';


const agentInfo = { roleName: 'Developer', agentName: 'Codex', modelName: 'gpt', effortName: 'high' };
const asker = { role: 'DEVELOPER', roleName: 'Developer', projectName: 'app' };
const prompt: QuestionPrompt = {
  asker,
  question: { text: 'Which?', rationale: 'Because', options: ['a', 'b'] },
  number: 1,
  total: 2,
  message: 'Before asking',
  waitingAskers: 0,
};

const entries = new ConversationEntryService();
const valid = (entry: unknown) => conversationEntrySchema.safeParse(entry).success;

describe('ConversationEntryService', () => {
  it('builds user messages, notices and interim entries that satisfy the protocol', () => {
    expect(entries.userMessage('hi')).toMatchObject({ type: 'user_message', text: 'hi' });
    expect(entries.notice('warning', 'careful')).toMatchObject({ type: 'notice', level: 'warning' });
    expect(entries.interim('wip')).toMatchObject({ type: 'interim', text: 'wip' });
    for (const entry of [entries.userMessage('hi'), entries.notice('info', 'x'), entries.interim('y')]) {
      expect(valid(entry)).toBe(true);
    }
  });

  describe('activity', () => {
    it('maps a thought with a stable id', () => {
      const entry = entries.activity({ kind: 'thought', id: 't1', text: 'hmm' }, 'CEO', 'turn-1');

      expect(entry).toMatchObject({ id: 'thought:turn-1:CEO:t1', type: 'thought', text: 'hmm' });
      expect(entry).not.toHaveProperty('removed');
    });

    it('gives agents that number their thoughts alike different ids', () => {
      const first = entries.activity({ kind: 'thought', id: 'synthetic:0', text: 'a' }, 'CEO', 'turn-1');
      const second = entries.activity({ kind: 'thought', id: 'synthetic:0', text: 'b' }, 'GIT_OPS', 'turn-1');

      expect(first?.id).not.toBe(second?.id);
    });

    it('gives the same step of different turns different ids', () => {
      const thought = (turnId: string) => entries.activity({ kind: 'thought', id: 'synthetic:0', text: 'a' }, 'CEO', turnId);
      const tool = (turnId: string) => entries.activity({ kind: 'tool', toolCallId: 'c1', title: 'T', status: 'pending' }, 'CEO', turnId);

      expect(thought('turn-1')?.id).not.toBe(thought('turn-2')?.id);
      expect(tool('turn-1')?.id).not.toBe(tool('turn-2')?.id);
    });

    it('gives a step streamed again within its turn the same id', () => {
      const update = (text: string) => entries.activity({ kind: 'thought', id: 'synthetic:0', text }, 'CEO', 'turn-1');

      expect(update('a')?.id).toBe(update('ab')?.id);
    });

    it('credits the step to the agent that produced it', () => {
      expect(entries.activity({ kind: 'thought', id: 't1', text: 'hmm' }, 'DEVELOPER', 'turn-1')).toMatchObject({ role: 'DEVELOPER' });
      expect(entries.activity({ kind: 'tool', toolCallId: 'c', title: 'T', status: 'pending' }, 'CODE_REVIEWER', 'turn-1')).toMatchObject({ role: 'CODE_REVIEWER' });
    });

    it('keeps a removed thought so clients can drop it', () => {
      expect(entries.activity({ kind: 'thought', id: 't1', text: '', removed: true }, 'CEO', 'turn-1')).toMatchObject({
        id: 'thought:turn-1:CEO:t1',
        removed: true,
      });
    });

    it('skips an empty thought', () => {
      expect(entries.activity({ kind: 'thought', id: 't1', text: '  ' }, 'CEO', 'turn-1')).toBeNull();
    });

    it('maps tools with optional result and details', () => {
      const entry = entries.activity({
        kind: 'tool',
        toolCallId: 'call-1',
        title: 'Read',
        status: 'completed',
        result: 'ok',
        details: 'file.ts',
      }, 'CEO', 'turn-1');

      expect(entry).toMatchObject({ id: 'tool:turn-1:CEO:call-1', type: 'tool', status: 'completed', result: 'ok', details: 'file.ts' });
      expect(entries.activity({ kind: 'tool', toolCallId: 'c', title: 'T', status: 'pending' }, 'CEO', 'turn-1')).not.toHaveProperty('result');
    });

    it('maps a skill read or written by an agent', () => {
      expect(entries.activity({ kind: 'skill', id: 's1', action: 'read', names: ['api-testing'], status: 'completed' }, 'QA', 'turn-1')).toMatchObject({
        id: 'skill:turn-1:QA:s1', type: 'skill', role: 'QA', action: 'read', names: ['api-testing'], status: 'completed',
      });
      const written = entries.activity({ kind: 'skill', id: 's2', action: 'write', names: ['x'], status: 'completed', created: true }, 'CEO', 'turn-1');
      const failed = entries.activity({ kind: 'skill', id: 's3', action: 'write', names: ['x'], status: 'failed', error: 'No.' }, 'CEO', 'turn-1');
      expect(written).toMatchObject({ created: true });
      expect(written).not.toHaveProperty('error');
      expect(failed).toMatchObject({ status: 'failed', error: 'No.' });
      expect(failed).not.toHaveProperty('created');
    });

    it('has no entry for steering or cancellation markers', () => {
      expect(entries.activity({ kind: 'steering', id: 's', text: 'x' }, 'CEO', 'turn-1')).toBeNull();
      expect(entries.activity({ kind: 'cancelled', id: 'c' }, 'CEO', 'turn-1')).toBeNull();
    });
  });

  describe('delegation', () => {
    it('maps a failed delegation with the reason and duration', () => {
      const entry = entries.delegation({
        delegationId: 'dl-1',
        phase: 'failed',
        round: 2,
        role: 'DEVELOPER',
        roleName: 'Developer',
        taskSpec: 'Do the work', summary: 'Adding the login screen',
        errorMessage: 'boom',
        durationMs: 800,
      });

      expect(entry).toMatchObject({ id: 'delegation:dl-1:failed', delegationId: 'dl-1', phase: 'failed', errorMessage: 'boom', durationMs: 800 });
      expect(entry).not.toHaveProperty('response');
      expect(valid(entry)).toBe(true);
    });

    it('maps a cancelled delegation', () => {
      const entry = entries.delegation({ delegationId: 'dl-1', phase: 'cancelled', round: 2, role: 'DEVELOPER', roleName: 'Developer', taskSpec: 'Do the work', summary: 'Adding the login screen', durationMs: 5 });

      expect(entry).toMatchObject({ id: 'delegation:dl-1:cancelled', delegationId: 'dl-1', phase: 'cancelled', durationMs: 5 });
      expect(valid(entry)).toBe(true);
    });

    it('maps a started delegation', () => {
      const entry = entries.delegation({ delegationId: 'dl-1', phase: 'started', round: 2, role: 'DEVELOPER', roleName: 'Developer', projectName: 'app', artifactId: 'T-3', taskSpec: 'Do the work', summary: 'Adding the login screen' });

      expect(entry).toMatchObject({ id: 'delegation:dl-1:started', delegationId: 'dl-1', phase: 'started', projectName: 'app', artifactId: 'T-3', prompt: 'Do the work', summary: 'Adding the login screen' });
      expect(entry).not.toHaveProperty('response');
      expect(valid(entry)).toBe(true);
    });

    it('maps a finished delegation with the response, agent info and duration', () => {
      const entry = entries.delegation({
        delegationId: 'dl-1',
        phase: 'finished',
        round: 2,
        role: 'DEVELOPER',
        roleName: 'Developer',
        taskSpec: 'Do the work', summary: 'Adding the login screen',
        response: 'done',
        agentInfo,
        durationMs: 1200,
      });

      expect(entry).toMatchObject({ id: 'delegation:dl-1:finished', delegationId: 'dl-1', response: 'done', agentInfo, durationMs: 1200 });
      expect(entry).not.toHaveProperty('projectName');
      expect(valid(entry)).toBe(true);
    });
  });

  describe('question', () => {
    it('maps every field', () => {
      const entry = entries.question(prompt);

      expect(entry).toMatchObject({
        type: 'question',
        askerRole: 'DEVELOPER',
        askerRoleName: 'Developer',
        projectName: 'app',
        text: 'Which?',
        rationale: 'Because',
        options: ['a', 'b'],
        number: 1,
        total: 2,
        closed: false,
        message: 'Before asking',
      });
      expect(valid(entry)).toBe(true);
    });

    it('carries the recommended option and the time the question expires', () => {
      const entry = entries.question({
        ...prompt,
        question: { ...prompt.question, recommendedIndex: 2 },
        timeout: { expiresAt: 1_700_000_000_000, durationMs: 300_000 },
      });

      expect(entry).toMatchObject({ recommendedIndex: 2, timeout: { expiresAt: 1_700_000_000_000, durationMs: 300_000 } });
      expect(valid(entry)).toBe(true);
    });

    it('omits absent optional fields', () => {
      const entry = entries.question({
        ...prompt,
        asker: { ...asker, projectName: null },
        question: { text: 'Which?', options: [] },
        message: undefined,
      });

      expect(entry).not.toHaveProperty('projectName');
      expect(entry).not.toHaveProperty('rationale');
      expect(entry).not.toHaveProperty('message');
      expect(entry).not.toHaveProperty('recommendedIndex');
      expect(entry).not.toHaveProperty('timeout');
    });
  });

  describe('agentResponse', () => {
    it('maps the turn result', () => {
      const entry = entries.agentResponse({ response: 'ok', status: 'failed', errorMessage: 'boom', agentInfo });

      expect(entry).toMatchObject({ type: 'agent_response', status: 'failed', response: 'ok', errorMessage: 'boom', agentInfo });
      expect(valid(entry)).toBe(true);
    });

    it('omits the error and agent info when absent', () => {
      const entry = entries.agentResponse({ response: 'ok', status: 'completed' });

      expect(entry).not.toHaveProperty('errorMessage');
      expect(entry).not.toHaveProperty('agentInfo');
    });
  });

  describe('submission', () => {
    it('shows the next question of the same request', () => {
      expect(entries.submission({ kind: 'next', prompt }).map(entry => entry.type)).toEqual(['question']);
    });

    it('warns and repeats the question after an invalid option', () => {
      const [warning, repeated] = entries.submission({ kind: 'invalid', prompt });

      expect(warning).toMatchObject({ type: 'notice', level: 'warning', text: expect.stringContaining('1 to 2') });
      expect(repeated).toMatchObject({ type: 'question' });
    });

    it('confirms the answers and hands over to the next asker, if any', () => {
      expect(entries.submission({ kind: 'answered', asker, next: prompt }).map(entry => entry.type)).toEqual(['notice', 'question']);
      expect(entries.submission({ kind: 'answered', asker })[0]).toMatchObject({ text: 'Answers sent to Developer (app).' });
      expect(entries.submission({ kind: 'answered', asker: { ...asker, projectName: null } })[0]).toMatchObject({
        text: 'Answers sent to Developer.',
      });
    });
  });
});
