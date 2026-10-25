import { beforeEach, describe, expect, it } from 'vitest';

import { PromptCancelledError } from '../../agent/ports/agent.port.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { CancelAgentTurnUseCase } from './cancel-agent-turn.use-case.js';


describe('CancelAgentTurnUseCase', () => {
  let useCase: CancelAgentTurnUseCase;
  let agentPort: StubAgentPort;
  let runtime: ConversationRuntimeService;
  let questionQueue: UserQuestionQueueService;

  beforeEach(() => {
    agentPort = new StubAgentPort();
    const factory = new StubAgentPortFactory(() => agentPort);
    runtime = new ConversationRuntimeService(factory, 60_000);
    questionQueue = new UserQuestionQueueService();
    useCase = new CancelAgentTurnUseCase(runtime, questionQueue);
  });

  const runBlockingTurn = (): { started: Promise<void>; finish: () => void; done: Promise<void> } => {
    let finish: () => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const done = runtime.run('conv-th-1', 'stub', () => new Promise<void>((resolve) => {
      finish = resolve;
      markStarted();
    }));
    return { started, finish: () => finish(), done };
  };

  it('should cancel the turn in progress and report it', async () => {
    const turn = runBlockingTurn();
    await turn.started;

    await expect(useCase.execute('conv-th-1')).resolves.toBe(true);

    expect(agentPort.cancelCalls).toBe(1);
    turn.finish();
    await turn.done;
  });

  it('should discard the questions waiting for the user and reject the agents waiting on them', async () => {
    const asker = { role: 'PRODUCT_OWNER', roleName: 'Product Owner', projectName: null };
    const waiting = questionQueue.ask('conv-th-1', asker, '', [{ text: 'Who approves?', options: [] }]);

    await expect(useCase.execute('conv-th-1')).resolves.toBe(true);

    await expect(waiting).rejects.toBeInstanceOf(PromptCancelledError);
    expect(questionQueue.hasPending('conv-th-1')).toBe(false);
  });

  it('should report false when the conversation has no turn in progress', async () => {
    await expect(useCase.execute('conv-th-1')).resolves.toBe(false);
    expect(agentPort.cancelCalls).toBe(0);
  });

  it('should ignore turns of other threads in the same channel', async () => {
    const turn = runBlockingTurn();
    await turn.started;

    await expect(useCase.execute('conv-th-2')).resolves.toBe(false);

    expect(agentPort.cancelCalls).toBe(0);
    turn.finish();
    await turn.done;
  });

  it('should rethrow when the agent fails to cancel', async () => {
    agentPort.cancel = async () => {
      throw new Error('cancel failed');
    };
    const turn = runBlockingTurn();
    await turn.started;

    await expect(useCase.execute('conv-th-1')).rejects.toThrow('cancel failed');
    turn.finish();
    await turn.done;
  });
});
