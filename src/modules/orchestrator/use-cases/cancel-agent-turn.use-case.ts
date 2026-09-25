import { Inject, Injectable, Logger } from '@nestjs/common';

import { ISessionStorePort } from '../ports/session-store.port.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';


@Injectable()
export class CancelAgentTurnUseCase {
  private readonly logger = new Logger(CancelAgentTurnUseCase.name);

  constructor(
    @Inject(ISessionStorePort)
    private readonly sessionStore: ISessionStorePort,
    private readonly conversationRuntime: ConversationRuntimeService,
  ) {}

  async execute(channelId: string, threadId?: string): Promise<boolean> {
    this.logger.log(
      `[Cancel Requested] For channel=${channelId}, thread=${threadId || 'none'}`,
    );

    const session = await this.sessionStore.findSession(channelId, threadId);
    if (!session) {
      this.logger.warn(
        `[Cancel Ignored] No session found for channel=${channelId}, thread=${threadId || 'none'}`,
      );
      return false;
    }

    try {
      const cancelled = await this.conversationRuntime.cancel(session.sessionId);
      if (cancelled) {
        this.logger.log(`[Cancel Signal Sent] Session=${session.sessionId}`);
      } else {
        this.logger.warn(`[Cancel Ignored] No turn in progress for session=${session.sessionId}`);
      }
      return cancelled;
    } catch (error) {
      this.logger.error(
        `[Cancel Failed] Error sending cancel signal for session=${session.sessionId}: ${error}`,
      );
      throw error;
    }
  }
}
