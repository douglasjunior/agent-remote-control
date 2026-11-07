import type { AgentOption } from '@agent-remote-control/protocol/agent-option';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useConnection } from '../connection/connection-context.js';
import { useConversations } from '../conversations/conversations-context.js';
import { emptyConversationView } from '../conversations/conversations-reducer.js';

import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { Separator } from './ui/separator.js';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet.js';


type Step =
  | { readonly name: 'agent' }
  | { readonly name: 'model'; readonly agentId: string; readonly models: readonly AgentOption[] | null }
  | {
    readonly name: 'effort';
    readonly agentId: string;
    readonly modelId: string;
    readonly efforts: readonly AgentOption[] | null;
  };

function OptionButtons({ options, onPick }: {
  readonly options: readonly AgentOption[];
  readonly onPick: (option: AgentOption) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(option => (
        <Button key={option.id} variant="outline" size="sm" onClick={() => onPick(option)}>
          {option.name}
        </Button>
      ))}
    </div>
  );
}

export function SettingsSheet({ conversationId, open, onOpenChange }: {
  readonly conversationId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { connection } = useConnection();
  const { state } = useConversations();
  const view = state.byId[conversationId] ?? emptyConversationView;
  const [step, setStep] = useState<Step>({ name: 'agent' });
  const [selectedRoles, setSelectedRoles] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(false);

  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'models.list') {
      setStep(current => current.name === 'model' && current.agentId === event.agentId
        ? { ...current, models: event.models }
        : current);
    } else if (event.type === 'efforts.list') {
      setStep(current => current.name === 'effort'
        && current.agentId === event.agentId && current.modelId === event.modelId
        ? { ...current, efforts: event.efforts }
        : current);
    } else if (event.type === 'error' && (!event.conversationId || event.conversationId === conversationId)) {
      setError(event.message);
      setStep(current => current.name === 'agent' ? current : { name: 'agent' });
    } else if (event.type === 'profiles' && event.conversationId === conversationId && submitted.current) {
      submitted.current = false;
      setStep({ name: 'agent' });
      onOpenChange(false);
    }
  }), [connection, conversationId, onOpenChange]);

  const apply = (agentId: string, modelId?: string, effortId?: string) => {
    submitted.current = true;
    connection.send({
      type: 'profiles.set',
      conversationId,
      ...(selectedRoles.length > 0 && { roles: [...selectedRoles] }),
      agentId,
      ...(modelId && { modelId }),
      ...(effortId && { effortId }),
    });
  };

  const pickAgent = (agent: AgentOption) => {
    setError(null);
    setStep({ name: 'model', agentId: agent.id, models: null });
    connection.send({ type: 'models.list', agentId: agent.id });
  };

  const pickModel = (agentId: string, model: AgentOption) => {
    setStep({ name: 'effort', agentId, modelId: model.id, efforts: null });
    connection.send({ type: 'efforts.list', agentId, modelId: model.id });
  };

  const toggleRole = (role: string) => setSelectedRoles(current => current.includes(role)
    ? current.filter(item => item !== role)
    : [...current, role]);

  const renderStep = () => {
    if (step.name === 'agent') {
      return <OptionButtons options={state.agents} onPick={pickAgent} />;
    }
    if (step.name === 'model') {
      if (step.models === null) {
        return <Loading label="Loading models…" />;
      }
      return step.models.length === 0
        ? <Button size="sm" onClick={() => apply(step.agentId)}>Use this agent</Button>
        : <OptionButtons options={step.models} onPick={model => pickModel(step.agentId, model)} />;
    }
    if (step.efforts === null) {
      return <Loading label="Loading efforts…" />;
    }
    return step.efforts.length === 0
      ? <Button size="sm" onClick={() => apply(step.agentId, step.modelId)}>Use this model</Button>
      : <OptionButtons options={step.efforts} onPick={effort => apply(step.agentId, step.modelId, effort.id)} />;
  };

  const heading = { agent: 'Choose an agent', model: 'Choose a model', effort: 'Choose an effort' }[step.name];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>The agent, model and effort each role uses in this conversation.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <ul className="flex flex-col gap-2 text-sm">
            {view.profiles.map(profile => (
              <li key={profile.role} className="flex flex-col gap-0.5">
                <span className="font-medium">{profile.roleName}</span>
                <span className="text-muted-foreground">
                  {profile.agent
                    ? [profile.agent.name, profile.model?.name, profile.effort?.name].filter(Boolean).join(' · ')
                    : 'Not configured'}
                  {profile.agent && !profile.agent.available && <Badge variant="destructive" className="ml-2">not installed</Badge>}
                </span>
              </li>
            ))}
          </ul>
          <Separator />
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Apply to</p>
            <div className="flex flex-wrap gap-2">
              {view.profiles.map(profile => (
                <Button
                  key={profile.role}
                  size="sm"
                  variant={selectedRoles.includes(profile.role) ? 'default' : 'outline'}
                  aria-pressed={selectedRoles.includes(profile.role)}
                  onClick={() => toggleRole(profile.role)}
                >
                  {profile.roleName}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedRoles.length === 0 ? 'Every role' : `${selectedRoles.length} selected`}
            </p>
          </div>
          <Separator />
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{heading}</p>
            {renderStep()}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Loading({ label }: { readonly label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />
      {label}
    </p>
  );
}
