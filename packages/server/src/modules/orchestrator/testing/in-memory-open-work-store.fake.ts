import type { IOpenWorkStorePort, OpenWorkByConversation } from '../ports/open-work-store.port.js';


export class InMemoryOpenWorkStoreFake implements IOpenWorkStorePort {
  saved: OpenWorkByConversation = {};
  failNextUpdate = false;

  async load(): Promise<OpenWorkByConversation> {
    return this.saved;
  }

  async update(change: (work: OpenWorkByConversation) => OpenWorkByConversation): Promise<void> {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error('disk full');
    }
    this.saved = change(this.saved);
  }
}
