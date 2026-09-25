import { Inject, Injectable, Logger } from '@nestjs/common';

import { IAgentPort } from '../../agent/ports/agent.port.js';
import { ISessionStorePort } from '../ports/session-store.port.js';


@Injectable()
export class CancelAgentTurnUseCase {
  private readonly logger = new Logger(CancelAgentTurnUseCase.name);

  constructor(
    @Inject(IAgentPort)
    private readonly agentPort: IAgentPort,
    @Inject(ISessionStorePort)
    private readonly sessionStore: ISessionStorePort,
  ) {}

  async execute(channelId: string, threadId?: string): Promise<void> {
    this.logger.log(
      `[Cancel Requested] For channel=${channelId}, thread=${threadId ?? 'none'}`,
    );

    const session = await this.sessionStore.findSession(channelId, threadId);
    if (!session) {
      this.logger.warn(
        `[Cancel Ignored] No active session found for channel=${channelId}, thread=${threadId ?? 'none'}`,
      );
      return;
    }

    await this.agentPort.cancel();
    this.logger.log(
      `[Cancel Signal Sent] Dispatched cancel signal to agent for session=${session.sessionId}`,
    );
  }
}
