import { Injectable } from '@nestjs/common';

import type { AgentAuthChoice } from '../models/agent-auth-choice.model.js';


type ActiveLogin = {
  readonly agentId: string;
  awaitingCode: boolean;
};

/**
 * What the agent login dialog of each conversation is waiting for: the agent the user picks from the
 * numbered menu, then, while a login runs, the code the user pastes from the browser.
 */
@Injectable()
export class AgentAuthRequestService {
  private readonly picks = new Map<string, readonly AgentAuthChoice[]>();
  private readonly logins = new Map<string, ActiveLogin>();

  /** The agents the menu offers, in menu order: the next message picks one by number. */
  requestPick(conversationId: string, choices: readonly AgentAuthChoice[]): void {
    this.picks.set(conversationId, choices);
  }

  pendingPick(conversationId: string): readonly AgentAuthChoice[] | undefined {
    return this.picks.get(conversationId);
  }

  /** Returns whether a pick was pending. */
  cancelPick(conversationId: string): boolean {
    return this.picks.delete(conversationId);
  }

  startLogin(conversationId: string, agentId: string): void {
    this.logins.set(conversationId, { agentId, awaitingCode: false });
  }

  /** The login's CLI waits for text: the next message in the conversation is that text. */
  awaitCode(conversationId: string): void {
    const login = this.logins.get(conversationId);
    if (login) {
      login.awaitingCode = true;
    }
  }

  /** The agent whose login waits for a pasted code in the conversation. */
  loginAwaitingCode(conversationId: string): string | undefined {
    const login = this.logins.get(conversationId);
    return login?.awaitingCode ? login.agentId : undefined;
  }

  runningLogin(conversationId: string): string | undefined {
    return this.logins.get(conversationId)?.agentId;
  }

  endLogin(conversationId: string): void {
    this.logins.delete(conversationId);
  }
}
