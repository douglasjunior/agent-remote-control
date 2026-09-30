export type AgentSettings = {
  readonly agentId: string;
  readonly agentName: string;
  readonly modelId: string | null;
  readonly modelName: string | null;
  readonly effortId: string | null;
  readonly effortName: string | null;
  readonly updatedAt: string;
};
