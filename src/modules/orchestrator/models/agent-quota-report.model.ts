import type { AgentQuota } from '../../agent/ports/agent.port.js';

import type { SelectedValue } from './agent-config-selection.model.js';


export type AgentQuotaStatus = 'ok' | 'unsupported' | 'failed';

export type AgentQuotaReport = {
  readonly agent: SelectedValue;
  readonly status: AgentQuotaStatus;
  readonly quota?: AgentQuota;
};
