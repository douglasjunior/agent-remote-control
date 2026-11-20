import type { AgentRequester } from './agent-request.model.js';
import type { SkillActivity } from './turn-activity.model.js';


/** A JSON Schema object, as MCP carries the input of a tool. */
export type JsonSchema = Readonly<Record<string, unknown>>;

export type AgentToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
};

/** The tools of a tool session and the instructions the agent reads about them. */
export type AgentToolCatalog = {
  readonly instructions: string;
  readonly tools: readonly AgentToolDefinition[];
};

/** `done` carries the text the agent reads back, flagged as an error when the request failed. */
export type AgentToolCallResult =
  | { readonly status: 'done'; readonly text: string; readonly isError: boolean }
  | { readonly status: 'unknown_tool' }
  | { readonly status: 'closed' };

/** How an agent CLI on this machine reaches the tools with a credential, or `undefined` while it cannot. */
export type AgentToolsEndpoint = {
  connection(credential: string): { readonly url: string; readonly headers: Readonly<Record<string, string>> } | undefined;
};

/** The agent a tool session acts for, with the same access as its requests, and who hears its skill activity. */
export type AgentToolSession = {
  readonly requester: AgentRequester;
  readonly onSkill?: (activity: SkillActivity) => void;
};
