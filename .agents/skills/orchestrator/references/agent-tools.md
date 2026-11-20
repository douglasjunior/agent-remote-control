# Agent Tools

The tools a tool session offers, built by `AgentToolCatalogService` from the role's `ArtifactAccess` and
`IAgentSkillsPort.writesSkills`, and read back into requests by `AgentToolRequestService`. Read before changing a
tool, a schema or the instructions.

## Rules

- A tool has the name of its request tag and carries out exactly that request: never give a tool a behavior, a check
  or a message its tag does not have.
- A tool answers within seconds: Cursor cancels a call after 60 s. Questions to the user, `<delegate>`,
  `<attachment>` and the final response stay tags.
- The skill catalog goes in the `instructions`, never in a tool description, which most CLIs never show the model;
  one tool per skill does not work either. `skill_read` keeps a neutral description.
- Schemas do not set `additionalProperties: false`: unknown arguments are ignored (Antigravity adds
  `toolSummary`), and an unreadable value fails the call with a reason, as an unreadable tag does.
- Every list property also takes a comma-separated string; ids are written as `T-1` whatever their case.

## Tools by access

| Tool | Offered to | Input |
|---|---|---|
| `artifact_list` | every role | `type` (array of `feature`, `task`; not for `scope: 'task'`, which lists tasks only), `status` (array of the statuses plus `all`), `parent` (id, `none` for the roots), `project` |
| `artifact_read` | every role | `ids` (required), `tree` (boolean, only for `scope: 'tree'`) |
| `artifact_create` | `create` | `type` and `title` (required), `parent`, `project`, `depends_on`, `business_refinement` and `technical_refinement` (with the `refinement` field), `sections` (`{ name, content }`, `name` among `overview` and the role's `sections`) |
| `artifact_update` | a role with any section or field | `id` (required); one property per field of the role: `title`, `status` (every status but `frozen`), `parent` (`none` clears), `project`, `depends_on` (empty clears), `business_refinement` and `technical_refinement`, `branch` (`none` clears), `pull_requests` (`{ url, title, state }`); `sections` (`{ name, content, mode }`, `mode` `replace` or `append`) when the role writes any; `note` |
| `artifact_comment` | every role | `id` and `text` (required) |
| `skill_read` | every role | `names` (required) |
| `skill_list` | `writesSkills` | none |
| `skill_write` | `writesSkills` | `name`, `description`, `roles` (enum of the registry roles) and `content`, all required |

With the built-in roles: the CEO gets all eight, its update with `title`, `status`, `parent`, `project`, `depends_on`,
both refinements, `sections` (`overview`) and `note`; the developer gets `artifact_list`, `artifact_read`,
`artifact_update` (`branch`, `pull_requests`, `sections` with `implementation_notes`, `note`), `artifact_comment` and
`skill_read`; the code reviewer the same five, its update with `sections` (`review_findings`) and `note` only; IT
support gets no `artifact_update`.

## Results

`RunAgentToolUseCase` returns the body the tag's `<request_result>` would hold, as `{ status: 'done', text, isError }`,
`isError` when the request failed; a tag that could not be read reads `<reason> (in <tool>)`. A creation returns the
new id, since a `ref` names nothing outside one response. Each call logs `[Agent Tool Call] Conversation, Role, Tool,
Failed` in the log context of its conversation, and a failure also logs `[Agent Request Failed]` as the tag path
does. `skill_read` and `skill_write` reach the channel as the `skill` activity of the agent.

## Instructions

```text
The board of this conversation and the skills of your team are reached through the tools of this server, and the skills your role may read are listed below.

Skills (read one in full with skill_read before the work it describes):
- <name>: <description>
```

The list is `IAgentSkillsPort.list(role)` at `initialize`, or `Your role has no skills.` Codex shows the model only the
first line, so that line must keep standing on its own.
