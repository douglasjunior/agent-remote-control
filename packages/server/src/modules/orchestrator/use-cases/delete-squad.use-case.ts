import { Inject, Injectable, Logger } from '@nestjs/common';

import { ISquadStorePort } from '../ports/squad-store.port.js';


/** Conversations that applied the squad keep their profiles. */
@Injectable()
export class DeleteSquadUseCase {
  private readonly logger = new Logger(DeleteSquadUseCase.name);

  constructor(@Inject(ISquadStorePort) private readonly squads: ISquadStorePort) {}

  async execute(squadId: string): Promise<boolean> {
    const deleted = await this.squads.delete(squadId);
    if (deleted) {
      this.logger.log(`[Squad Deleted] ${squadId}`);
    }
    return deleted;
  }
}
