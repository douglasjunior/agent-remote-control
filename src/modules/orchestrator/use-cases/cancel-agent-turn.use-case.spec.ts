import { beforeEach, describe, expect, it } from 'vitest';

import type { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { InMemorySessionStoreFake } from '../testing/in-memory-session-store.fake.js';
import { buildSessionContext } from '../testing/session-context.fixture.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { CancelAgentTurnUseCase } from './cancel-agent-turn.use-case.js';


describe('CancelAgentTurnUseCase', () => {
  let useCase: CancelAgentTurnUseCase;
  let agentPort: StubAgentPort;
  let sessionStore: InMemorySessionStoreFake;
  let runtime: ConversationRuntimeService;

  beforeEach(async () => {
    agentPort = new StubAgentPort();
    sessionStore = new InMemorySessionStoreFake();
    const factory: IAgentPortFactory = { create: () => agentPort };
    runtime = new ConversationRuntimeService(factory, 60_000);
    useCase = new CancelAgentTurnUseCase(sessionStore, runtime);
    await sessionStore.saveSession(
      buildSessionContext({ sessionId: 'sess-1', channelId: 'ch-1', threadId: 'th-1' }),
    );
  });

  const runBlockingTurn = (): { finish: () => void; done: Promise<void> } => {
    let finish: () => void = () => undefined;
    const done = runtime.run('sess-1', () => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    return { finish: () => finish(), done };
  };

  it('should cancel the turn in progress and report it', async () => {
    const turn = runBlockingTurn();
    await Promise.resolve();

    await expect(useCase.execute('ch-1', 'th-1')).resolves.toBe(true);

    expect(agentPort.cancelCalls).toBe(1);
    turn.finish();
    await turn.done;
  });

  it('should report false when the session has no turn in progress', async () => {
    await expect(useCase.execute('ch-1', 'th-1')).resolves.toBe(false);
    expect(agentPort.cancelCalls).toBe(0);
  });

  it('should report false when session is not found', async () => {
    await expect(useCase.execute('ch-unknown')).resolves.toBe(false);
  });

  it('should rethrow when the agent fails to cancel', async () => {
    agentPort.cancel = async () => {
      throw new Error('cancel failed');
    };
    const turn = runBlockingTurn();
    await Promise.resolve();

    await expect(useCase.execute('ch-1', 'th-1')).rejects.toThrow('cancel failed');
    turn.finish();
    await turn.done;
  });
});
