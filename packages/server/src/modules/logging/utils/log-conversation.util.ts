import { AsyncLocalStorage } from 'node:async_hooks';


const conversation = new AsyncLocalStorage<string>();

/** Everything `work` logs, including what it starts asynchronously, belongs to the conversation. */
export function runInLogConversation<T>(conversationId: string | undefined, work: () => T): T {
  return conversationId === undefined ? work() : conversation.run(conversationId, work);
}

export function currentLogConversation(): string | undefined {
  return conversation.getStore();
}
