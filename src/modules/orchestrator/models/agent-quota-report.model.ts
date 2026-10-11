import type { AgentQuota } from '../../agent/ports/agent.port.js';

import type { SelectedValue } from './agent-config-selection.model.js';


export type AgentQuotaReport = {
  readonly agent: SelectedValue;
  readonly quota: AgentQuota | undefined;
};
