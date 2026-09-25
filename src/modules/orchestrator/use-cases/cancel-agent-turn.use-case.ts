import { Inject, Injectable, Logger } from '@nestjs/common';

import { ISessionStorePort } from '../ports/session-store.port.js';


@Injectable()
export class CancelAgentTurnUseCase {
  private readonly logger = new Logger(CancelAgentTurnUseCase.name);

  constructor(
    @Inject(ISessionStorePort)
    private readonly sessionStore: ISessionStorePort,
  ) {}

  async execute(channelId: string, threadId?: string): Promise<void> {
    this.logger.log(
      `[Cancel Requested] For channel=${channelId}, thread=${threadId || 'none'}`,
    );

    const session = await this.sessionStore.findSession(
      channelId,
      threadId,
    );

    if (!session) {
      this.logger.warn(
        `[Cancel Ignored] No active session found for channel=${channelId}, thread=${threadId || 'none'}`,
      );
      return;
    }

    try {
      await session.activeAgentPort.cancel();
      this.logger.log(
        `[Cancel Signal Sent] Dispatched cancel signal to agent for session=${session.sessionId}`,
      );
    } catch (error) {
      this.logger.error(
        `[Cancel Failed] Error sending cancel signal for session=${session.sessionId}: ${error}`,
      );
      throw error;
    }
  }
}
