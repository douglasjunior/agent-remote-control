import { Injectable } from '@nestjs/common';


/** Conversations where the next message the user sends is the language they want. */
@Injectable()
export class LanguageChangeRequestService {
  private readonly pending = new Set<string>();

  request(conversationId: string): void {
    this.pending.add(conversationId);
  }

  isPending(conversationId: string): boolean {
    return this.pending.has(conversationId);
  }

  /** Returns whether a request was pending. */
  cancel(conversationId: string): boolean {
    return this.pending.delete(conversationId);
  }
}
