# 03 — Protocol package

**Model:** Sonnet 5.5 · **Effort:** low · **Depends on:** 01

## Goal

Create `packages/protocol`: the message contract between the web interface and the server, with Zod schemas for runtime validation and the TypeScript types inferred from them. It has no logic beyond the schemas, and no dependency on the server or on React.

## Read first

`AGENTS.md`, `.agents/skills/code-organization/SKILL.md`, `.agents/skills/tests-best-practices/SKILL.md`, and these files for the shapes the protocol mirrors: `packages/server/src/modules/orchestrator/models/{turn-result,turn-agent-info,user-question,delegation-event,agent-config-selection}.model.ts` and `AgentActivity` in `packages/server/src/modules/agent/ports/agent.port.ts`.

## Package setup

- `packages/protocol/package.json`: `@agent-remote-control/protocol`, `"type": "module"`, `zod` as a dependency, scripts `build` (`tsc -p tsconfig.build.json`) and `ts`.
- **Subpath exports with a source condition**, so TypeScript and Vitest read the `.ts` sources without a build, while Node at runtime reads `dist`:

  ```json
  "exports": {
    "./*": {
      "source": "./src/*.ts",
      "types": "./dist/*.d.ts",
      "default": "./dist/*.js"
    }
  }
  ```

  Add `"customConditions": ["source"]` to the `tsconfig.json` of packages that consume the protocol (server now, web in plan 06), and `resolve.conditions: ['source']` to their Vitest configs.
- Add `@agent-remote-control/protocol` as a `workspace:*` dependency of the server.
- Add a Vitest project `protocol` and make sure `yarn build` builds it before the server.

## Files

One concept per file, no `index.ts`:

```text
src/
├── conversation.ts       # ConversationSummary, ConversationState
├── conversation-entry.ts # ConversationEntry union
├── client-command.ts     # ClientCommand union + parseClientCommand()
├── server-event.ts       # ServerEvent union + parseServerEvent()
└── limits.ts             # MAX_MESSAGE_LENGTH = 20_000
```

Each file exports a Zod schema and its inferred type (`export const clientCommandSchema = ...; export type ClientCommand = z.infer<typeof clientCommandSchema>;`). `parseX(data: unknown)` returns `{ ok: true, value } | { ok: false, error: string }` and never throws.

## Contract

All unions discriminate on `type`. Timestamps are ISO strings.

**`ConversationSummary`:** `{ id, title, createdAt, updatedAt }`.
**`ConversationState`:** `'idle' | 'queued' | 'running'`.

**`ConversationEntry`:** every entry has `id` (stable; the client and the history store upsert by it) and `at`.

| `type` | Fields | `id` convention |
|---|---|---|
| `user_message` | `text` | random |
| `thought` | `text`, `removed?` | `thought:<activity id>` |
| `tool` | `title`, `status` (`pending`, `in_progress`, `completed`, `failed`), `result?`, `details?` | `tool:<toolCallId>` |
| `delegation` | `phase` (`started`, `finished`), `round`, `role`, `roleName`, `projectName?`, `response?`, `agentInfo?`, `durationMs?` | `delegation:<round>:<role>:<phase>` |
| `interim` | `text` | random |
| `question` | `askerRoleName`, `projectName?`, `text`, `rationale?`, `options[]`, `number`, `total`, `message?` | random |
| `selection` | `mode` (`selection`, `invalid`, `profiles_menu`), `step` (`profile`, `agent`, `model`, `effort`), `options[]` (`index`, `label`, `description?`), `selectedAgent?`, `selectedModel?` | random |
| `notice` | `level` (`info`, `warning`, `error`), `text` | random |
| `agent_response` | `status` (`completed`, `cancelled`, `failed`, `steered`), `response`, `errorMessage?`, `agentInfo?` (`roleName`, `agentName`, `modelName?`, `effortName?`) | random |

Check the `tool` status values against `AgentToolStatus` in `agent.port.ts` and mirror them exactly.

**`ClientCommand`:**

| `type` | Fields |
|---|---|
| `auth` | `token` |
| `conversation.list` | — |
| `conversation.create` | `requestId` |
| `conversation.history` | `conversationId` |
| `message.send` | `conversationId`, `text` (1 to `MAX_MESSAGE_LENGTH` characters after trimming) |
| `turn.cancel` | `conversationId` |
| `config.open` | `conversationId`, `menu` (`agent`, `model`, `profiles`) |
| `config.cancel` | `conversationId` |

**`ServerEvent`:**

| `type` | Fields |
|---|---|
| `auth.ok` | — |
| `auth.failed` | — |
| `conversation.list` | `conversations: ConversationSummary[]` |
| `conversation.created` | `requestId`, `conversation` |
| `conversation.updated` | `conversation` |
| `conversation.history` | `conversationId`, `entries`, `state` |
| `conversation.entry` | `conversationId`, `entry` |
| `conversation.state` | `conversationId`, `state` |
| `error` | `message`, `conversationId?` |

## Tests

One spec per file: valid samples of every variant parse; unknown `type`, missing fields, empty or oversized `text` and non-objects return `ok: false`. 100% coverage of the package.

## Acceptance

`yarn ts`, `yarn lint`, `yarn test` and `yarn build` pass; `packages/protocol/dist/client-command.js` exists after the build.

## Out of scope

Using the protocol in the server (plans 04 and 05) or the web (plan 06).

## Commit

`feat(protocol): add the web channel message contract`
