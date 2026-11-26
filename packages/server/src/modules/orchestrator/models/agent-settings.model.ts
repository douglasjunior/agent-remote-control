export type AgentProfileSettings = {
  readonly agentId: string;
  readonly agentName: string;
  readonly modelId: string | null;
  readonly modelName: string | null;
  readonly effortId: string | null;
  readonly effortName: string | null;
};

/** The squad whose profiles were last copied into a conversation, as it was named then. */
export type AppliedSquad = {
  readonly id: string;
  readonly name: string;
};

export type AgentSettings = {
  readonly profiles: Readonly<Record<string, AgentProfileSettings>>;
  readonly appliedSquad?: AppliedSquad;
  readonly updatedAt: string;
};
