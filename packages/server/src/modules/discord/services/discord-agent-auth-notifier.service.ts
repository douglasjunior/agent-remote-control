import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AgentLoginEvent } from '../../agent/models/agent-auth.model.js';
import { IAgentAuthPort } from '../../agent/ports/agent-auth.port.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import type { AgentAuthChoice } from '../models/agent-auth-choice.model.js';

import { AgentAuthRequestService } from './agent-auth-request.service.js';


export type AuthMessageChannel = {
  send: (content: string) => Promise<unknown>;
};

/**
 * Runs an agent CLI login for a Discord conversation and reports it in the thread or DM the user is in:
 * the link and one-time code, the request for a pasted code, and the result. The link, the code and
 * the pasted text are credentials-adjacent and never reach the log; the log only gets the outcome.
 */
@Injectable()
export class DiscordAgentAuthNotifierService {
  private readonly logger = new Logger(DiscordAgentAuthNotifierService.name);

  constructor(
    @Inject(IAgentAuthPort) private readonly agentAuth: IAgentAuthPort,
    private readonly requests: AgentAuthRequestService,
    private readonly formatter: DiscordActivityFormatter,
  ) {}

  /** Starts the login and resolves once it started; the progress follows as messages in the channel. */
  async start(conversationId: string, agent: AgentAuthChoice, channel: AuthMessageChannel): Promise<void> {
    const { agentId, displayName } = agent;
    this.requests.startLogin(conversationId, agentId);
    await this.post(channel, this.formatter.formatAgentLoginStarting(displayName));
    let chain = Promise.resolve();
    try {
      this.agentAuth.startLogin(agentId, (event) => {
        chain = chain.then(() => this.report(conversationId, agent, event, channel));
      });
    } catch (error) {
      this.requests.endLogin(conversationId);
      const reason = error instanceof Error ? error.message : 'The login could not start.';
      await this.post(channel, this.formatter.formatAgentLoginResult(displayName, { kind: 'failed', reason })!);
    }
  }

  /** Stops the login of the conversation; the channel is told through the login's own `cancelled` event. */
  cancel(conversationId: string): boolean {
    const agentId = this.requests.runningLogin(conversationId);
    if (!agentId) {
      return false;
    }
    this.agentAuth.cancelLogin(agentId);
    return true;
  }

  private async report(
    conversationId: string,
    { displayName }: AgentAuthChoice,
    event: AgentLoginEvent,
    channel: AuthMessageChannel,
  ): Promise<void> {
    if (event.kind === 'url') {
      await this.post(channel, this.formatter.formatAgentLoginLink(displayName, event.url, event.code));
      return;
    }
    if (event.kind === 'prompt') {
      this.requests.awaitCode(conversationId);
      await this.post(channel, this.formatter.formatAgentLoginPrompt());
      return;
    }
    this.requests.endLogin(conversationId);
    this.logger.log(`[Agent Login] ${event.kind} (conversation=${conversationId})`);
    await this.post(channel, this.formatter.formatAgentLoginResult(displayName, event)!);
  }

  private async post(channel: AuthMessageChannel, content: string): Promise<void> {
    try {
      await channel.send(content);
    } catch (error) {
      this.logger.warn(`agent_login_message_failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
