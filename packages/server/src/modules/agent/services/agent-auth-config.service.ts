import { Inject, Injectable } from '@nestjs/common';

import { IRuntimeSettingsPort } from '../../settings/ports/runtime-settings.port.js';


@Injectable()
export class AgentAuthConfigService {
  constructor(@Inject(IRuntimeSettingsPort) private readonly settings: IRuntimeSettingsPort) {}

  isEnabled(): boolean {
    return this.settings.get('AGENT_AUTH_ENABLED');
  }

  getLoginTimeoutMs(): number {
    return this.settings.get('AGENT_AUTH_LOGIN_TIMEOUT_MS');
  }

  getStatusTimeoutMs(): number {
    return this.settings.get('AGENT_AUTH_STATUS_TIMEOUT_MS');
  }
}
