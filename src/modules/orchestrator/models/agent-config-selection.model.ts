export type SelectionOption = {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export type SelectedValue = { readonly id: string; readonly name: string };

export type AgentConfigSelection = {
  readonly conversationId: string;
  readonly step: 'profile' | 'agent' | 'model' | 'effort';
  readonly options: readonly SelectionOption[];
  readonly selectedAgent?: SelectedValue;
  readonly selectedModel?: SelectedValue;
  readonly pendingPrompt?: string;
  /** Roles chosen at the profile step; undefined means every role. */
  readonly targetRoles?: readonly string[];
};
