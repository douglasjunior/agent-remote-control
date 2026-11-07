import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';


/** The conversation whose work is running, so every log line written while it runs can be tagged with it. */
@Injectable()
export class ConversationLogContextService {
  private readonly conversation = new AsyncLocalStorage<string>();

  /** Everything `work` logs, including what it starts asynchronously, belongs to the conversation. */
  run<T>(conversationId: string | undefined, work: () => T): T {
    return conversationId === undefined ? work() : this.conversation.run(conversationId, work);
  }

  current(): string | undefined {
    return this.conversation.getStore();
  }
}
