import { conversationEntrySchema } from '@agent-remote-control/protocol/conversation-entry';

import type { QuestionPrompt } from '../../orchestrator/models/user-question.model.js';

import {
  activityEntry,
  agentResponseEntry,
  delegationEntry,
  interimEntry,
  noticeEntry,
  questionEntry,
  submissionEntries,
  userMessageEntry,
} from './conversation-entry.util.js';


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

const valid = (entry: unknown) => conversationEntrySchema.safeParse(entry).success;

describe('conversation entry mapping', () => {
  it('builds user messages, notices and interim entries that satisfy the protocol', () => {
    expect(userMessageEntry('hi')).toMatchObject({ type: 'user_message', text: 'hi' });
    expect(noticeEntry('warning', 'careful')).toMatchObject({ type: 'notice', level: 'warning' });
    expect(interimEntry('wip')).toMatchObject({ type: 'interim', text: 'wip' });
    for (const entry of [userMessageEntry('hi'), noticeEntry('info', 'x'), interimEntry('y')]) {
      expect(valid(entry)).toBe(true);
    }
  });

  describe('activityEntry', () => {
    it('maps a thought with a stable id', () => {
      const entry = activityEntry({ kind: 'thought', id: 't1', text: 'hmm' }, 'CEO', 'turn-1');

      expect(entry).toMatchObject({ id: 'thought:turn-1:CEO:t1', type: 'thought', text: 'hmm' });
      expect(entry).not.toHaveProperty('removed');
    });

    it('gives agents that number their thoughts alike different ids', () => {
      const first = activityEntry({ kind: 'thought', id: 'synthetic:0', text: 'a' }, 'CEO', 'turn-1');
      const second = activityEntry({ kind: 'thought', id: 'synthetic:0', text: 'b' }, 'GIT_OPS', 'turn-1');

      expect(first?.id).not.toBe(second?.id);
    });

    it('gives the same step of different turns different ids', () => {
      const thought = (turnId: string) => activityEntry({ kind: 'thought', id: 'synthetic:0', text: 'a' }, 'CEO', turnId);
      const tool = (turnId: string) => activityEntry({ kind: 'tool', toolCallId: 'c1', title: 'T', status: 'pending' }, 'CEO', turnId);

      expect(thought('turn-1')?.id).not.toBe(thought('turn-2')?.id);
      expect(tool('turn-1')?.id).not.toBe(tool('turn-2')?.id);
    });

    it('gives a step streamed again within its turn the same id', () => {
      const update = (text: string) => activityEntry({ kind: 'thought', id: 'synthetic:0', text }, 'CEO', 'turn-1');

      expect(update('a')?.id).toBe(update('ab')?.id);
    });

    it('credits the step to the agent that produced it', () => {
      expect(activityEntry({ kind: 'thought', id: 't1', text: 'hmm' }, 'DEVELOPER', 'turn-1')).toMatchObject({ role: 'DEVELOPER' });
      expect(activityEntry({ kind: 'tool', toolCallId: 'c', title: 'T', status: 'pending' }, 'CODE_REVIEWER', 'turn-1')).toMatchObject({ role: 'CODE_REVIEWER' });
    });

    it('keeps a removed thought so clients can drop it', () => {
      expect(activityEntry({ kind: 'thought', id: 't1', text: '', removed: true }, 'CEO', 'turn-1')).toMatchObject({
        id: 'thought:turn-1:CEO:t1',
        removed: true,
      });
    });

    it('skips an empty thought', () => {
      expect(activityEntry({ kind: 'thought', id: 't1', text: '  ' }, 'CEO', 'turn-1')).toBeNull();
    });

    it('maps tools with optional result and details', () => {
      const entry = activityEntry({
        kind: 'tool',
        toolCallId: 'call-1',
        title: 'Read',
        status: 'completed',
        result: 'ok',
        details: 'file.ts',
      }, 'CEO', 'turn-1');

      expect(entry).toMatchObject({ id: 'tool:turn-1:CEO:call-1', type: 'tool', status: 'completed', result: 'ok', details: 'file.ts' });
      expect(activityEntry({ kind: 'tool', toolCallId: 'c', title: 'T', status: 'pending' }, 'CEO', 'turn-1')).not.toHaveProperty('result');
    });

    it('has no entry for steering or cancellation markers', () => {
      expect(activityEntry({ kind: 'steering', id: 's', text: 'x' }, 'CEO', 'turn-1')).toBeNull();
      expect(activityEntry({ kind: 'cancelled', id: 'c' }, 'CEO', 'turn-1')).toBeNull();
    });
  });

  describe('delegationEntry', () => {
    it('maps a failed delegation with the reason and duration', () => {
      const entry = delegationEntry({
        delegationId: 'dl-1',
        phase: 'failed',
        round: 2,
        role: 'DEVELOPER',
        roleName: 'Developer',
        summary: 'Adding the login screen',
        errorMessage: 'boom',
        durationMs: 800,
      });

      expect(entry).toMatchObject({ id: 'delegation:dl-1:failed', delegationId: 'dl-1', phase: 'failed', errorMessage: 'boom', durationMs: 800 });
      expect(entry).not.toHaveProperty('response');
      expect(valid(entry)).toBe(true);
    });

    it('maps a started delegation', () => {
      const entry = delegationEntry({ delegationId: 'dl-1', phase: 'started', round: 2, role: 'DEVELOPER', roleName: 'Developer', projectName: 'app', summary: 'Adding the login screen' });

      expect(entry).toMatchObject({ id: 'delegation:dl-1:started', delegationId: 'dl-1', phase: 'started', projectName: 'app', summary: 'Adding the login screen' });
      expect(entry).not.toHaveProperty('response');
      expect(valid(entry)).toBe(true);
    });

    it('maps a finished delegation with the response, agent info and duration', () => {
      const entry = delegationEntry({
        delegationId: 'dl-1',
        phase: 'finished',
        round: 2,
        role: 'DEVELOPER',
        roleName: 'Developer',
        summary: 'Adding the login screen',
        response: 'done',
        agentInfo,
        durationMs: 1200,
      });

      expect(entry).toMatchObject({ id: 'delegation:dl-1:finished', delegationId: 'dl-1', response: 'done', agentInfo, durationMs: 1200 });
      expect(entry).not.toHaveProperty('projectName');
      expect(valid(entry)).toBe(true);
    });
  });

  describe('questionEntry', () => {
    it('maps every field', () => {
      const entry = questionEntry(prompt);

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

    it('omits absent optional fields', () => {
      const entry = questionEntry({
        ...prompt,
        asker: { ...asker, projectName: null },
        question: { text: 'Which?', options: [] },
        message: undefined,
      });

      expect(entry).not.toHaveProperty('projectName');
      expect(entry).not.toHaveProperty('rationale');
      expect(entry).not.toHaveProperty('message');
    });
  });

  describe('agentResponseEntry', () => {
    it('maps the turn result', () => {
      const entry = agentResponseEntry({ response: 'ok', status: 'failed', errorMessage: 'boom', agentInfo });

      expect(entry).toMatchObject({ type: 'agent_response', status: 'failed', response: 'ok', errorMessage: 'boom', agentInfo });
      expect(valid(entry)).toBe(true);
    });

    it('omits the error and agent info when absent', () => {
      const entry = agentResponseEntry({ response: 'ok', status: 'completed' });

      expect(entry).not.toHaveProperty('errorMessage');
      expect(entry).not.toHaveProperty('agentInfo');
    });
  });

  describe('submissionEntries', () => {
    it('shows the next question of the same request', () => {
      expect(submissionEntries({ kind: 'next', prompt }).map(entry => entry.type)).toEqual(['question']);
    });

    it('warns and repeats the question after an invalid option', () => {
      const entries = submissionEntries({ kind: 'invalid', prompt });

      expect(entries[0]).toMatchObject({ type: 'notice', level: 'warning', text: expect.stringContaining('1 to 2') });
      expect(entries[1]).toMatchObject({ type: 'question' });
    });

    it('confirms the answers and hands over to the next asker, if any', () => {
      expect(submissionEntries({ kind: 'answered', asker, next: prompt }).map(entry => entry.type)).toEqual(['notice', 'question']);
      expect(submissionEntries({ kind: 'answered', asker })[0]).toMatchObject({ text: 'Answers sent to Developer (app).' });
      expect(submissionEntries({ kind: 'answered', asker: { ...asker, projectName: null } })[0]).toMatchObject({
        text: 'Answers sent to Developer.',
      });
    });
  });
});
