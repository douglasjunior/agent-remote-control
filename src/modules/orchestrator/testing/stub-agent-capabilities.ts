import type { AgentEffortState, AgentModelState } from '../../agent/ports/agent.port.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';

import { StubAgentPort } from './stub-agent.port.js';


export function createAgentCapabilities(
  models: AgentModelState | null,
  effortsByModel: Record<string, AgentEffortState | null> = {},
): AgentCapabilitiesService {
  return new AgentCapabilitiesService({
    create: () => {
      const port = new StubAgentPort();
      port.modelsToReturn = models;
      port.effortsByModel = effortsByModel;
      return port;
    },
  });
}
