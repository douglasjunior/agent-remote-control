export type AgentProfileSettings = {
  readonly agentId: string;
  readonly agentName: string;
  readonly modelId: string | null;
  readonly modelName: string | null;
  readonly effortId: string | null;
  readonly effortName: string | null;
};

export type AgentSettings = {
  readonly profiles: Readonly<Record<string, AgentProfileSettings>>;
  readonly updatedAt: string;
};
