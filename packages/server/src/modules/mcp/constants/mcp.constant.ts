export const MCP_PATH = '/mcp';

/** Newest first; a client that asks for another version gets the newest. */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export const MCP_SERVER_INFO = { name: 'agent-remote-control', version: '1.0.0' };

/** Large enough for a whole skill or artifact section written in one call. */
export const MCP_MAX_BODY_BYTES = 4 * 1024 * 1024;
