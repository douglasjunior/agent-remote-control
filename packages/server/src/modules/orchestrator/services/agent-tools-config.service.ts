import { Injectable } from '@nestjs/common';


@Injectable()
export class AgentToolsConfigService {
  /** `AGENT_MCP_ENABLED=false` leaves every agent on requests written as tags. */
  isEnabled(): boolean {
    return process.env.AGENT_MCP_ENABLED?.trim().toLowerCase() !== 'false';
  }
}
