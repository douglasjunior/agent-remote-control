import type { AgentOption } from '@agent-remote-control/protocol/agent-option';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../ui/button.js';

import { OptionSelect } from './option-select.js';
import { type AgentOptions, effortKey } from './use-agent-options.js';


export type ProfileChoice = {
  readonly agentId: string;
  readonly modelId?: string;
  readonly effortId?: string;
};

/**
 * Agent, model and effort for one role or for the whole team. A model is required when the agent offers models, and
 * an effort when the model offers efforts, so what is saved always runs.
 */
export function RoleEditor({ label, agents, initial, options, saving, error, saveLabel, onSave, onCancel }: {
  readonly label: string;
  readonly agents: readonly AgentOption[];
  readonly initial: Partial<ProfileChoice>;
  readonly options: AgentOptions;
  readonly saving: boolean;
  readonly error: string | null;
  readonly saveLabel: string;
  readonly onSave: (choice: ProfileChoice) => void;
  readonly onCancel: () => void;
}) {
  const [agentId, setAgentId] = useState(agents.some(agent => agent.id === initial.agentId) ? initial.agentId : undefined);
  const [modelId, setModelId] = useState(initial.modelId);
  const [effortId, setEffortId] = useState(initial.effortId);
  const { requestModels, requestEfforts } = options;
  const group = useRef<HTMLDivElement>(null);

  useEffect(() => {
    group.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, []);

  const models = agentId ? options.models[agentId] : undefined;
  const modelList = Array.isArray(models) ? models as readonly AgentOption[] : undefined;
  const chosenModel = modelList?.some(model => model.id === modelId) ? modelId : undefined;
  const efforts = agentId && chosenModel ? options.efforts[effortKey(agentId, chosenModel)] : undefined;
  const effortList = Array.isArray(efforts) ? efforts as readonly AgentOption[] : undefined;
  const chosenEffort = effortList?.some(effort => effort.id === effortId) ? effortId : undefined;

  useEffect(() => {
    if (agentId) {
      requestModels(agentId);
    }
  }, [agentId, requestModels]);

  useEffect(() => {
    if (agentId && chosenModel) {
      requestEfforts(agentId, chosenModel);
    }
  }, [agentId, chosenModel, requestEfforts]);

  const modelReady = modelList !== undefined && (modelList.length === 0 || chosenModel !== undefined);
  const effortReady = modelList?.length === 0 || (effortList !== undefined && (effortList.length === 0 || chosenEffort !== undefined));
  const ready = agentId !== undefined && modelReady && effortReady;
  const agentName = agents.find(agent => agent.id === agentId)?.name ?? 'This agent';

  return (
    <div ref={group} role="group" aria-label={label} className="flex flex-col gap-3 pt-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <OptionSelect
          label="Agent"
          value={agentId}
          options={agents}
          placeholder="Choose an agent"
          emptyText="No agent is installed."
          onChange={(id) => {
            setAgentId(id);
            setModelId(undefined);
            setEffortId(undefined);
          }}
        />
        <OptionSelect
          label="Model"
          value={chosenModel}
          options={models}
          placeholder={agentId ? 'Choose a model' : 'Pick an agent first'}
          emptyText={`${agentName} runs on its default model.`}
          onChange={(id) => {
            setModelId(id);
            setEffortId(undefined);
          }}
        />
        <OptionSelect
          label="Effort"
          value={chosenEffort}
          options={modelList?.length === 0 ? [] : efforts}
          placeholder={chosenModel ? 'Choose an effort' : 'Pick a model first'}
          emptyText="No effort to choose."
          onChange={setEffortId}
        />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button
          size="sm"
          disabled={!ready || saving}
          aria-busy={saving}
          onClick={() => onSave({
            agentId: agentId!,
            ...(chosenModel && { modelId: chosenModel }),
            ...(chosenModel && chosenEffort && { effortId: chosenEffort }),
          })}
        >
          {saving && <LoaderCircle className="animate-spin" />}
          {saving ? 'Saving…' : saveLabel}
        </Button>
      </div>
    </div>
  );
}
