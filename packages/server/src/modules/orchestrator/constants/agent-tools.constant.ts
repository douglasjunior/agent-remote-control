/** The MCP server name agents see the tools under, such as `mcp__arc__artifact_update`. */
export const AGENT_TOOLS_SERVER_NAME = 'arc';

/** One tool per agent request, named after its tag. */
export const AGENT_TOOL_NAMES = [
  'artifact_list',
  'artifact_read',
  'artifact_create',
  'artifact_update',
  'artifact_comment',
  'skill_read',
  'skill_list',
  'skill_write',
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];
