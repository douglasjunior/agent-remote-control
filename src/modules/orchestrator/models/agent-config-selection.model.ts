export type SelectionOption = {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export type SelectedValue = { readonly id: string; readonly name: string };

export type AgentConfigSelection = {
  readonly conversationId: string;
  readonly step: 'agent' | 'model' | 'effort';
  readonly options: readonly SelectionOption[];
  readonly selectedAgent?: SelectedValue;
  readonly selectedModel?: SelectedValue;
  readonly pendingPrompt?: string;
};
