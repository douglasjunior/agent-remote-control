import type { AgentConfigSelection } from './agent-config-selection.model.js';
import type { AgentSettings } from './agent-settings.model.js';


export type AgentConfigSelectionOutcome =
  | { readonly kind: 'selection'; readonly selection: AgentConfigSelection }
  | { readonly kind: 'invalid'; readonly selection: AgentConfigSelection }
  | {
    readonly kind: 'configured';
    readonly settings: AgentSettings;
    readonly pendingPrompt?: string;
  };

export type StartAgentConfigSelectionResult =
  | { readonly kind: 'selection'; readonly selection: AgentConfigSelection }
  | { readonly kind: 'unavailable' };

export type ConversationInputResolution =
  | Exclude<AgentConfigSelectionOutcome, { kind: 'configured' }>
  | { readonly kind: 'configured'; readonly settings: AgentSettings }
  | {
    readonly kind: 'execute';
    readonly prompt: string;
    readonly configured?: AgentSettings;
  };
