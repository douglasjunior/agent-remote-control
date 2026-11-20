export type JsonRpcId = string | number | null;

export type JsonRpcResponse =
  | { readonly jsonrpc: '2.0'; readonly id: JsonRpcId; readonly result: unknown }
  | { readonly jsonrpc: '2.0'; readonly id: JsonRpcId; readonly error: { readonly code: number; readonly message: string } };

export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;
/** A server error: the tool session closed after the request was let in. */
export const JSON_RPC_SESSION_CLOSED = -32001;

export function jsonRpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
