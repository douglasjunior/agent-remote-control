import { UNSET_LABEL } from '../constants/unset-label.constant.js';
import type { TurnAgentInfo } from '../models/turn-agent-info.model.js';
import { escapeTagAttribute } from '../utils/protocol-tag.util.js';


/** What a result says about the agent that produced it, besides its role and project. */
export type AgentResultDetails = {
  /** `stopped`: the user ended the work on its artifact before the agent finished. */
  readonly status?: 'failed' | 'stopped';
  readonly agentInfo?: TurnAgentInfo;
  readonly artifactId?: string;
  /** The status of the artifact when the agent finished, which the CEO sets next from the result. */
  readonly artifactStatus?: string;
  /** The user set that status while the agent worked, which makes it their decision. */
  readonly artifactStatusByUser?: boolean;
};

/** The block that hands an agent's output to the CEO. */
export function buildAgentResult(
  role: string,
  projectName: string | undefined,
  body: string,
  details: AgentResultDetails = {},
): string {
  const project = projectName ? ` project="${projectName}"` : '';
  const artifact = details.artifactId
    ? ` artifact="${details.artifactId}"${details.artifactStatus ? ` artifact_status="${details.artifactStatus}"` : ''}${details.artifactStatusByUser ? ' artifact_status_by="user"' : ''}`
    : '';
  const { agentInfo } = details;
  const config = agentInfo
    ? ` agent="${escapeTagAttribute(agentInfo.agentName)}" model="${escapeTagAttribute(agentInfo.modelName ?? UNSET_LABEL)}" effort="${escapeTagAttribute(agentInfo.effortName ?? UNSET_LABEL)}"`
    : '';
  const status = details.status ? ` status="${details.status}"` : '';
  return `<agent_result role="${role}"${project}${artifact}${config}${status}>\n${body}\n</agent_result>`;
}
