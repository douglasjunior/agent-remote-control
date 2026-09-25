export type SelectionOption = {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export type AgentConfigSelection = {
  readonly channelId: string;
  readonly threadId?: string;
  readonly step: 'model' | 'effort';
  readonly options: readonly SelectionOption[];
  readonly selectedModel?: { readonly id: string; readonly name: string };
  readonly pendingPrompt?: string;
};
