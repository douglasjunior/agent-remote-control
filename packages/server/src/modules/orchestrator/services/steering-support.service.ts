import { Injectable } from '@nestjs/common';


/**
 * Whether each coding agent takes a new instruction into a running prompt, as its last connection said. The CEO reads
 * it before choosing what happens to an agent already at work, so it outlives the ports that learned it.
 */
@Injectable()
export class SteeringSupportService {
  private readonly support = new Map<string, boolean>();

  record(agentId: string, supported: boolean): void {
    this.support.set(agentId, supported);
  }

  /** `undefined` until a port of the agent has connected. */
  supports(agentId: string): boolean | undefined {
    return this.support.get(agentId);
  }
}
