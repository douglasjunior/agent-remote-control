import { Injectable } from '@nestjs/common';


const DEFAULT_LOGIN_TIMEOUT_MS = 900_000;
const DEFAULT_STATUS_TIMEOUT_MS = 10_000;

@Injectable()
export class AgentAuthConfigService {
  isEnabled(): boolean {
    return process.env.AGENT_AUTH_ENABLED?.trim().toLowerCase() !== 'false';
  }

  getLoginTimeoutMs(): number {
    return Number(process.env.AGENT_AUTH_LOGIN_TIMEOUT_MS) || DEFAULT_LOGIN_TIMEOUT_MS;
  }

  getStatusTimeoutMs(): number {
    return Number(process.env.AGENT_AUTH_STATUS_TIMEOUT_MS) || DEFAULT_STATUS_TIMEOUT_MS;
  }
}
