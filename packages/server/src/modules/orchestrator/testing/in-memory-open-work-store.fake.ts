import type { IOpenWorkStorePort, OpenWorkByConversation } from '../ports/open-work-store.port.js';


export class InMemoryOpenWorkStoreFake implements IOpenWorkStorePort {
  saved: OpenWorkByConversation = {};
  failNextSave = false;

  async load(): Promise<OpenWorkByConversation> {
    return this.saved;
  }

  async save(work: OpenWorkByConversation): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('disk full');
    }
    this.saved = work;
  }
}
