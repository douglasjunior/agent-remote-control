# AGENTS — Agent Remote Control

## Overview

**Agent Remote Control** is a NestJS application for remote control and orchestration of AI software development agents, running over the **Agent Client Protocol (ACP)** and controlled through pluggable channel interfaces, starting with a **Discord Bot**.

The project follows **Clean Architecture with Ports & Adapters**, decoupling the business core from external technologies (Discord, the ACP SDK, the file system and processes). Behavior and business rules are orchestrated directly by independent, cohesive **Use Cases**.

Everything in the repository is written in **English**: source code, identifiers, tests, comments, documentation (`AGENTS.md`, README, skills) and commit messages.

## Repository Structure

```text
agent-remote-control/
├── .agents/                        # AI agent governance
│   └── skills/                     # Catalog of on-demand skills (SKILL.md)
├── data/                           # Runtime data persisted in DATA_DIR (outside Git): sessions, per-conversation agent settings and global preferences (user language)
├── src/                            # NestJS application source code
│   ├── modules/                    # Vertical modules segregated by domain
│   │   ├── agent/                  # ACP integration: IAgentPort port, factory, adapters, bridges and demux
│   │   ├── agent-definitions/      # Agent catalog (CEO, GIT_OPS, PRODUCT_OWNER, TECH_LEAD, DEVELOPER, CODE_REVIEWER), prompts and registry
│   │   ├── discord/                # Discord Bot: handlers, formatters and progress utils
│   │   ├── orchestrator/           # Turns, per-conversation queue, delegation and cancellation
│   │   └── workspace/              # Workspace directory and manifest
│   │
│   │   Internal folders of a module (each module uses only the ones it needs):
│   │       ├── adapters/           # Secondary/technology adapters (*.adapter.ts)
│   │       ├── bridges/            # Bridge processes between protocols (e.g. ACP ↔ agy)
│   │       ├── constants/          # Domain constants
│   │       ├── demux/              # Decomposition of streams into typed events
│   │       ├── formatters/         # Output formatting for the channel
│   │       ├── handlers/           # Primary/driving adapters (Discord events/commands)
│   │       ├── models/             # Domain types and models (*.model.ts, *.type.ts)
│   │       ├── ports/              # Interfaces and injection Symbols (*.port.ts)
│   │       ├── prompts/            # Agent system prompts (*.prompt.ts)
│   │       ├── services/           # Concrete supporting services (*.service.ts)
│   │       ├── testing/            # Stubs, fakes and fixtures shared by tests
│   │       ├── use-cases/          # Business rules and orchestration (*.use-case.ts)
│   │       ├── utils/              # Utilities without domain state (*.util.ts)
│   │       └── <name>.module.ts    # Module configuration and NestJS DI wiring
│   ├── app.controller.ts           # Root diagnostics/healthcheck controller
│   ├── app.module.ts               # Application root module
│   ├── app.service.ts              # Application root service
│   └── main.ts                     # NestJS application bootstrap
├── .github/workflows/              # CI/CD: publishes the multi-platform Docker image to Docker Hub on every GitHub release
├── test/                           # e2e tests and global test utilities
├── Dockerfile                      # Production image (Debian-based) with the app and Codex
├── docker-entrypoint.sh            # Provides the CLIs listed in ARC_AGENTS at container startup
├── .dockerignore                   # Files excluded from the Docker build context
├── vitest.config.ts                # Vitest configuration for unit tests
├── vitest.config.e2e.ts            # Vitest configuration for e2e tests
├── tsconfig.json                   # Base TypeScript configuration
├── nest-cli.json                   # NestJS CLI configuration
└── package.json                    # Project dependencies and scripts
```

## `.agents/` Structure

- `.agents/skills/`: Skills loaded on demand by the agent. Each folder contains a prescriptive `SKILL.md`.

Before creating or changing any code, consult the catalog in `.agents/skills/`, inspecting the `description` in each frontmatter to load the mandatory rules for the topic.

## Cross-Cutting Conventions

- **Commit messages**: Conventional Commits (Angular) in **English**, imperative mood in the present tense (e.g. "add", "fix"), subject line of up to 50 characters with no trailing period. When there is detailed context, separate the body with a blank line.
- **Language**: Everything in **English** — identifiers, file names, classes, interfaces, methods, variables, test descriptions (`describe`, `it`), comments, documentation, skills and commit messages.
- **Testing with Vitest**:
  - Unit tests live side by side with the files under test, following the `*.spec.ts` pattern.
  - Target of **100% coverage** of executable production code lines.
  - `vi.mock` is restricted **exclusively to external I/O boundaries** (third-party SDKs such as Discord.js and the ACP SDK, and native Node modules such as `node:fs` and `node:child_process`). Internal code in `src/` is **never** mocked with `vi.mock`; use stubs/fakes that implement the ports (`implements IMyPort`).
- **Ban on barrel exports (`index.ts`)**:
  - Do not use `index.ts` files that re-export symbols from folders or modules. Always import directly from the symbol's source file to avoid unnecessary coupling and circular dependencies.

## Writing Comments and Documentation

All text kept in the repository describes the **current state**, written for whoever reads the file today without consulting the repository history or earlier conversations:

- **Describe what is, never the transition**: Write from the consolidated result. Phrases such as "no longer", "became", "now is", "used to be", "instead of" and "without needing to" are forbidden, except when recording business decisions in commit messages or migration specs.
- **Negate only to prevent a plausible mistake**: A negative constraint ("do not use X") is only justified when a competent reader would try X and the sentence explains why it would fail.
- **Three-question test before commenting**:
  1. Does it say something the code does not express?
  2. Would a competent reader try the alternative it rules out?
  3. Will it still be true after the next refactor?
- **Mandatory pruning pass**: Before finishing any task, inspect the documentation and comment additions in the diff (`git diff`) and cut whatever is redundant or obvious.

## Essential Commands

- Install dependencies: `yarn install`
- Development mode with watch: `yarn start:dev`
- Build: `yarn build`
- TypeScript static type checking: `yarn ts`
- Linter: `yarn lint`
- Code formatting via ESLint: `yarn format` (or `yarn lint:fix`)
- Run unit tests: `yarn test`
- Test coverage: `yarn test:cov`
- End-to-end (e2e) tests: `yarn test:e2e`

## Mandatory Rules for AI Agents

1. **Consult skills before acting**: Before creating or changing code, check the catalog in `.agents/skills/` and follow the governing skill.
2. **Follow the NestJS Clean Architecture pattern**:
   - Use cases orchestrate business rules (`*.use-case.ts`).
   - Ports define interfaces and injection Symbols (`*.port.ts`).
   - Adapters implement technical ports (`*.adapter.ts`).
   - Dependency injection via `@Inject(IMyPort)`.
   - NestJS modules configure providers by binding the Symbol to the concrete class (`{ provide: IMyPort, useClass: MyAdapter }`).
3. **Orchestration via Use Cases**: All business logic and flow coordination is done exclusively by Use Case classes (`*.use-case.ts`). Do not use workflow classes.
4. **No barrel exports**: Import classes, ports and types directly from their definition file, without `index.ts`.
5. **No obvious comments**: Do not repeat what the code, typing or signature already says.
6. **Stubs and fakes for internal dependencies**: Isolate internal `src/` dependencies by injecting stubs in the constructor or overriding providers in `Test.createTestingModule`; `vi.mock` is reserved for external I/O boundaries.
7. **Pruning pass before finishing**: Check comments and text introduced in the diff and remove any noise before submitting.
8. **Mandatory type checking, lint and tests on every change**: Any code change in the project requires running `yarn ts`, `yarn lint` and `yarn test` (plus `yarn test:e2e` when touching entry points). Code formatting is the sole responsibility of ESLint (`yarn format`). No delivery can be completed with TypeScript errors, lint errors or test failures.
9. **Skills in sync with the code**: Every change to a port contract, public signature, lifecycle or rule described in a skill updates the skill in the same commit. Before finishing, compare the skills of the touched module against the `git diff`.
