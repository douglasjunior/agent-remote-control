import type { AgentOption } from '@agent-remote-control/protocol/agent-option';
import type { RoleProfile } from '@agent-remote-control/protocol/agent-profile';

import { type AgentOptions, effortKey, type OptionList } from './use-agent-options.js';


export type ProfileChoice = {
  readonly agentId: string;
  readonly modelId?: string;
  readonly effortId?: string;
};

/** What the editor holds while the user picks; any id may be missing or no longer offered. */
export type ProfileDraft = Partial<ProfileChoice>;

/** The lists a draft is picked from and the ids of the draft still found in them. */
export type ProfileDraftState = {
  readonly agentId: string | undefined;
  readonly models: OptionList | undefined;
  readonly modelList: readonly AgentOption[] | undefined;
  readonly modelId: string | undefined;
  readonly efforts: OptionList | undefined;
  readonly effortList: readonly AgentOption[] | undefined;
  readonly effortId: string | undefined;
};

const asList = (list: OptionList | undefined) => (Array.isArray(list) ? list as readonly AgentOption[] : undefined);

export function profileDraftState(draft: ProfileDraft, agents: readonly AgentOption[], options: AgentOptions): ProfileDraftState {
  const agentId = agents.some(agent => agent.id === draft.agentId) ? draft.agentId : undefined;
  const models = agentId ? options.models[agentId] : undefined;
  const modelList = asList(models);
  const modelId = modelList?.some(model => model.id === draft.modelId) ? draft.modelId : undefined;
  const efforts = agentId && modelId ? options.efforts[effortKey(agentId, modelId)] : undefined;
  const effortList = asList(efforts);
  const effortId = effortList?.some(effort => effort.id === draft.effortId) ? draft.effortId : undefined;
  return { agentId, models, modelList, modelId, efforts, effortList, effortId };
}

/**
 * The choice a draft makes once it runs: a model is required when the agent offers models, and an effort when the
 * model offers efforts. `null` while it does not, or while a list it needs has not arrived.
 */
export function completeChoice(draft: ProfileDraft, agents: readonly AgentOption[], options: AgentOptions): ProfileChoice | null {
  const { agentId, modelList, modelId, effortList, effortId } = profileDraftState(draft, agents, options);
  const modelReady = modelList !== undefined && (modelList.length === 0 || modelId !== undefined);
  const effortReady = modelList?.length === 0 || (effortList !== undefined && (effortList.length === 0 || effortId !== undefined));
  if (agentId === undefined || !modelReady || !effortReady) {
    return null;
  }
  return { agentId, ...(modelId && { modelId }), ...(modelId && effortId && { effortId }) };
}

export function draftOf(profile: RoleProfile): ProfileDraft {
  return { agentId: profile.agent?.id, modelId: profile.model?.id, effortId: profile.effort?.id };
}
