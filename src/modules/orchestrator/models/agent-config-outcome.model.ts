import type { AgentConfigSelection, SelectedValue } from './agent-config-selection.model.js';
import type { AgentProfileSettings, AgentSettings } from './agent-settings.model.js';
import type { AudioTranscript } from './audio-transcription.model.js';
import type { TurnAttachment } from './turn-attachment.model.js';
import type { QuestionAsker, QuestionPrompt } from './user-question.model.js';


export type AgentConfigSelectionOutcome =
  | { readonly kind: 'selection'; readonly selection: AgentConfigSelection }
  | { readonly kind: 'invalid'; readonly selection: AgentConfigSelection }
  | { readonly kind: 'profiles_menu'; readonly selection: AgentConfigSelection }
  | {
    readonly kind: 'profiles_updated';
    readonly selection: AgentConfigSelection;
    readonly updatedRoles: readonly SelectedValue[];
    readonly profile: AgentProfileSettings;
  }
  | { readonly kind: 'profiles_closed' }
  | {
    readonly kind: 'configured';
    readonly settings: AgentSettings;
    readonly pendingPrompt?: string;
  };

export type StartAgentConfigSelectionResult =
  | { readonly kind: 'selection'; readonly selection: AgentConfigSelection }
  | { readonly kind: 'profiles_menu'; readonly selection: AgentConfigSelection }
  | { readonly kind: 'unavailable' };

export type ConversationInputResolution =
  | Exclude<AgentConfigSelectionOutcome, { kind: 'configured' }>
  | { readonly kind: 'configured'; readonly settings: AgentSettings }
  | { readonly kind: 'question'; readonly prompt: QuestionPrompt }
  | { readonly kind: 'invalid_answer'; readonly prompt: QuestionPrompt }
  | { readonly kind: 'answered'; readonly asker: QuestionAsker; readonly next?: QuestionPrompt }
  | { readonly kind: 'language_set'; readonly language: string }
  | { readonly kind: 'invalid_language' }
  | {
    readonly kind: 'execute';
    readonly prompt: string;
    readonly configured?: AgentSettings;
    /** Attachments of the message that remain after audio was transcribed; omitted when there are none. */
    readonly attachments?: readonly TurnAttachment[];
  };

/** Audio handled while resolving the input, for the channel to report to the user. */
export type InputTranscription = {
  readonly transcripts: readonly AudioTranscript[];
  readonly warnings: readonly string[];
};

export type ResolvedConversationInput = ConversationInputResolution & {
  /** Present only when the message carried audio that was transcribed or could not be. */
  readonly transcription?: InputTranscription;
};
