import type { AgentOption } from '@agent-remote-control/protocol/agent-option';
import { useEffect } from 'react';

import { OptionSelect } from './option-select.js';
import { type ProfileDraft, profileDraftState } from './profile-choice.js';
import type { AgentOptions } from './use-agent-options.js';


/**
 * Agent, model and effort for one role or for the whole team, controlled by its owner: picking an agent clears the
 * model and the effort, and picking a model clears the effort. It asks for the lists of what is picked.
 */
export function RoleEditor({ label, agents, value, options, onChange }: {
  /** Names the group of the three choices; without it the owner names the group around them. */
  readonly label?: string;
  readonly agents: readonly AgentOption[];
  readonly value: ProfileDraft;
  readonly options: AgentOptions;
  readonly onChange: (value: ProfileDraft) => void;
}) {
  const { agentId, models, modelList, modelId, efforts, effortId } = profileDraftState(value, agents, options);
  const { requestModels, requestEfforts } = options;

  useEffect(() => {
    if (agentId) {
      requestModels(agentId);
    }
  }, [agentId, requestModels]);

  useEffect(() => {
    if (agentId && modelId) {
      requestEfforts(agentId, modelId);
    }
  }, [agentId, modelId, requestEfforts]);

  const agentName = agents.find(agent => agent.id === agentId)?.name ?? 'This agent';

  return (
    <div role={label ? 'group' : undefined} aria-label={label} className="grid gap-3 sm:grid-cols-3">
      <OptionSelect
        label="Agent"
        value={agentId}
        options={agents}
        placeholder="Choose an agent"
        emptyText="No agent is installed."
        onChange={id => onChange({ agentId: id })}
      />
      <OptionSelect
        label="Model"
        value={modelId}
        options={models}
        placeholder={agentId ? 'Choose a model' : 'Pick an agent first'}
        emptyText={`${agentName} runs on its default model.`}
        onChange={id => onChange({ agentId, modelId: id })}
      />
      <OptionSelect
        label="Effort"
        value={effortId}
        options={modelList?.length === 0 ? [] : efforts}
        placeholder={modelId ? 'Choose an effort' : 'Pick a model first'}
        emptyText="No effort to choose."
        onChange={id => onChange({ agentId, modelId, effortId: id })}
      />
    </div>
  );
}
