/**
 * How an agent session reaches the board and the skills: `tools`, the MCP tools attached to the session, or `tags`,
 * requests written in its final response. Every prompt and skill the agent reads is written for its session's.
 */
export type AgentInterface = 'tags' | 'tools';
