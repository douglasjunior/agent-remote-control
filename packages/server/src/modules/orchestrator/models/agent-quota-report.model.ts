import type { AgentQuota } from '../../agent/ports/agent.port.js';

import type { AgentOption } from './agent-option.model.js';


export type AgentQuotaStatus = 'ok' | 'unsupported' | 'failed';

export type AgentQuotaReport = {
  readonly agent: Pick<AgentOption, 'id' | 'name'>;
  readonly status: AgentQuotaStatus;
  readonly quota?: AgentQuota;
};
