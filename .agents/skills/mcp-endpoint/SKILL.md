---
name: mcp-endpoint
description: >
  The mcp module: the Streamable HTTP MCP endpoint at /mcp on the server's own port that serves the agent tools
  (board and skill requests) to agent CLIs, its bearer credential check, the JSON-RPC methods it answers (initialize,
  tools/list, tools/call, ping), plain JSON responses, GET and DELETE, and AGENT_MCP_ENABLED. Use when working with
  the MCP endpoint, MCP JSON-RPC, the credential of a tool session or how an agent CLI reaches the tools.
---

# MCP Endpoint

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes. The criterion is not *which* rule — it is the
> nature of the change: a transport, credential, method or reachability rule changed → update; a technical refactor
> that preserves the described behavior → leave it alone.

`McpModule` (`packages/server/src/modules/mcp/`) is an inbound adapter: it depends only on the orchestrator's public
`IAgentToolsPort` and holds no tool, schema or access rule of its own. What the tools do, which agent gets them and
when a credential opens and closes belong to the orchestrator.

## Rules

- **Its own entry on the HTTP server.** `McpHttpHandler` takes the `request` listeners of the Nest HTTP server in
  `onModuleInit`, answers `MCP_PATH` (`/mcp`, exact path) itself and hands every other request to them, giving them
  back in `onModuleDestroy`. The endpoint must not become a Nest route or middleware: Nest's JSON body parser runs
  before both and would read the body of a caller without a credential, and the static web app would answer `GET`.
- **Credential first.** A request without `Authorization: Bearer <credential>`, or with a credential
  `IAgentToolsPort.isOpen` refuses, gets `401` with `WWW-Authenticate: Bearer` before its body is read. The web
  access token, the origin and any other channel rule play no part: only a credential the orchestrator opened for a
  working agent passes.
- **Reachable from the agent CLI.** `onModuleInit` calls `IAgentToolsPort.serveAt` with a `connection(credential)`
  that builds the URL from the address the server listens on: `127.0.0.1` for an unspecified address (`0.0.0.0`,
  `::`), the address itself otherwise (IPv6 in brackets), `undefined` while it listens on no port. The credential
  travels in the `authorization` header.
- **Plain JSON, no MCP session.** `POST` takes one JSON-RPC message or a batch and answers `200` with
  `application/json` (an array for a batch), or `202` without a body when it held only notifications or responses. It
  sends no `Mcp-Session-Id` and opens no server-to-client stream: `GET` answers `405` (`Allow: POST, DELETE`), and
  `DELETE` answers `200`, since a client may never send it.
- **HTTP errors**: a body over `MCP_MAX_BODY_BYTES` (4 MiB) answers `413`, a body that is not JSON `400` with
  `-32700`, an empty batch `400` with `-32600`, an unexpected failure `500`.
- **JSON-RPC** (`McpRpcService`): `initialize` answers the client's `protocolVersion` when it is in
  `MCP_PROTOCOL_VERSIONS`, the newest otherwise, with `capabilities: { tools: { listChanged: false } }`,
  `MCP_SERVER_INFO` and the session's `instructions`; `ping` answers `{}`; `tools/list` the session's tools;
  `resources/list`, `resources/templates/list` and `prompts/list` empty lists. Any other method answers `-32601`
  `Method not found: <method>`, which clients that start with `server/discover` carry on from. A message without a
  `method` answers `-32600` unless it is a response of the client, which, like a notification, gets nothing.
- **`tools/call`**: `params.name` is required (`-32602`) and `params.arguments` defaults to `{}`, passed whole to
  `IAgentToolsPort.call`. `done` becomes `{ content: [{ type: 'text', text }], isError }`, `unknown_tool` answers
  `-32602` `Unknown tool: <name>`, `closed` answers `-32001`. A call that throws becomes a failed call the agent reads
  (`The server failed to carry out <name>: <reason>`), never a JSON-RPC error.
- **Logs**: a refused credential is logged at debug level only, since a CLI keeps calling a server whose session
  ended. Never log a credential.
- **Switch**: `AGENT_MCP_ENABLED=false` makes the orchestrator attach the server to no agent; the endpoint stays up
  and refuses every credential, since none is opened. Those agents get the prompts and skills of the tags interface.
- **Server name**: agents know the server by the name the orchestrator attaches it under (`arc`), which the prompts
  of the tools interface use; `MCP_SERVER_INFO.name` plays no part in them.

## Tests

- `McpRpcService` with `StubAgentToolsPort`; `McpHttpHandler` on a real `node:http` server on `127.0.0.1:0`, driven
  with `fetch`, with an `HttpAdapterHost` that returns that server and a listener standing for Nest.
- `test/agent-tools.e2e-spec.ts` boots `AppModule` with a stub agent factory whose CEO takes HTTP MCP servers, runs a
  turn through `IAgentTurnPort`, and drives `initialize`, `tools/list` and `tools/call` over real HTTP with the server
  the CEO received.

## Checklist

- [ ] The module imports only `OrchestratorModule` and uses only `IAgentToolsPort`.
- [ ] Nothing about `/mcp` is a Nest route, middleware or static exclusion.
- [ ] Every path refuses a missing or closed credential before reading the body.
- [ ] A new method or status code is reflected here and in the specs of the handler and the service.
