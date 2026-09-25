import { Inject, Injectable } from '@nestjs/common';

import { IAgentPort } from '../../agent/ports/agent.port.js';
import { ISessionStorePort } from '../ports/session-store.port.js';


@Injectable()
export class CancelAgentTurnUseCase {
  constructor(
    @Inject(IAgentPort)
    private readonly agentPort: IAgentPort,
    @Inject(ISessionStorePort)
    private readonly sessionStore: ISessionStorePort,
  ) {}

  async execute(channelId: string, threadId?: string): Promise<void> {
    const session = await this.sessionStore.findSession(channelId, threadId);
    if (!session) {
      return;
    }

    await this.agentPort.cancel();
  }
}
