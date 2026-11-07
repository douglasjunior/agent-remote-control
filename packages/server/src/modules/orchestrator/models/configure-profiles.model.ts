export type ConfigureProfilesInput = {
  readonly conversationId: string;
  /** Every role when omitted. */
  readonly roles?: readonly string[];
  readonly agentId: string;
  readonly modelId?: string;
  readonly effortId?: string;
};

export type ConfigureProfilesResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type ConversationSettingsStatus = 'configured' | 'inherited' | 'missing';
