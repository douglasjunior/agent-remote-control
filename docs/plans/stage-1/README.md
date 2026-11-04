# Stage 1 delivery plans

Stage 1 of the [roadmap](../../ROADMAP.md): a Yarn workspaces monorepo plus a local web channel. The whole stage is delivered on the branch `feat/stage-1-web-channel`, which merges into `main` through a single pull request once plan 08 is done. Each plan is sized for a single focused session and self-contained, so it runs without the conversation that produced it.

## Order and model

| # | Plan | Depends on | Model | Effort |
|---|---|---|---|---|
| 01 | [Monorepo: relocate the server](01-monorepo-server.md) | — | Sonnet 5.5 | medium |
| 02 | [Monorepo: Docker, CI and docs](02-monorepo-docker-ci-docs.md) | 01 | Sonnet 5.5 | low |
| 03 | [Protocol package](03-protocol-package.md) | 01 | Sonnet 5.5 | low |
| 04 | [Server: transport, auth and static serving](04-server-transport.md) | 03 | Sonnet 5.5 | high |
| 05 | [Server: web conversations](05-server-conversations.md) | 04 | Sonnet 5.5 | high |
| 06 | [Web: scaffold and connection](06-web-scaffold.md) | 03 | Sonnet 5.5 | medium |
| 07 | [Web: chat interface](07-web-chat.md) | 05, 06 | Sonnet 5.5 | medium |
| 08 | [Integration and release](08-integration.md) | 07 | Sonnet 5.5 | low |

02 and 03 can run in parallel after 01; 06 can run in parallel with 04 and 05.

**Why these choices.** The plans fix the design decisions up front, so execution needs care more than invention. Sonnet 5.5 covers every plan. Effort goes up where a mistake is expensive: 04 exposes command execution over the network and 05 mirrors the most intricate flow in the codebase (`discord-message.handler.ts`). Low effort fits work that is mostly relocation or configuration fully specified in the plan.

**Cheaper follow-ups.** Fixing lint errors, closing small coverage gaps or syncing docs after a plan: Haiku 5.5, medium effort.

**Optional review.** After 04 and after 05, run `/code-review high` in a fresh session before merging.

## Running a plan

Start a fresh session per plan and prompt:

```text
Implement docs/plans/stage-1/0N-<name>.md. Follow AGENTS.md and the skills it points to.
Work on the branch feat/stage-1-web-channel, run the acceptance checks, then commit and push.
```

Keep a draft pull request from `feat/stage-1-web-channel` to `main` open from the start, so the CI added in plan 02 checks every push.

Every plan ends with the checks from `AGENTS.md`: `yarn ts`, `yarn lint` and `yarn test`, plus `yarn test:e2e` when entry points change. A plan is done only when all of them pass.

## Decisions shared by every plan

- **Package names:** `@agent-remote-control/server`, `@agent-remote-control/protocol`, `@agent-remote-control/web`, all `"private": true`.
- **Runtime files stay at the repository root:** `.env`, `data/` and `workspaces/`. Existing installs keep working without moving anything.
- **Shared tooling at the root:** `tsconfig.base.json`, `eslint.config.js` and a root `vitest.config.ts` listing each package as a Vitest project. Each package keeps only what differs.
- **No barrels:** packages expose files through subpath exports (`@agent-remote-control/protocol/client-command`), never through an `index.ts`.
- **Text only in Stage 1:** attachments, audio, `/shell`, `/usage` and `/language` stay Discord features for now.
