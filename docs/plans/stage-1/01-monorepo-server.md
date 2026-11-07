# 01 — Monorepo: relocate the server

**Model:** Sonnet 5.5 · **Effort:** medium · **Depends on:** nothing

## Goal

Turn the repository into a Yarn 4 workspaces monorepo and move the NestJS application into `packages/server` with **no behavior change**. Every existing test passes untouched except for import paths.

## Read first

`AGENTS.md`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `vitest.config.ts`, `vitest.config.e2e.ts`, `eslint.config.js`, `.gitignore`, `src/main.ts`, `src/modules/orchestrator/utils/data-directory.util.ts`, `src/modules/workspace/adapters/local-workspace.adapter.ts`.

## Target layout

```text
package.json            # private, "workspaces": ["packages/*"], root scripts, shared devDependencies
tsconfig.base.json      # compiler options shared by every package
eslint.config.js        # one flat config for the whole repository
vitest.config.ts        # test.projects: ['packages/*'] and shared coverage settings
packages/server/
├── package.json        # @agent-remote-control/server: runtime dependencies and server scripts
├── nest-cli.json
├── tsconfig.json       # extends ../../tsconfig.base.json
├── tsconfig.build.json
├── vitest.config.ts    # unit project "server"
├── vitest.config.e2e.ts
├── src/
└── test/
```

## Steps

1. `git mv src test nest-cli.json tsconfig.build.json vitest.config.e2e.ts packages/server/` and create `packages/server/vitest.config.ts` from the current root one. Use `git mv` so history follows the files.
2. Split `package.json`:
   - **Root:** `"private": true`, `"workspaces": ["packages/*"]`, `packageManager`, and the devDependencies used by every package: `typescript`, `eslint` and its plugins, `vitest`, `@vitest/coverage-v8`, `vite-tsconfig-paths`, `globals`, `@types/node`.
   - **Server:** the runtime `dependencies` and the server-only devDependencies (`@nestjs/cli`, `@nestjs/schematics`, `@nestjs/testing`, `@nestjs/mau`, `supertest`, `@types/express`, `@types/supertest`, `source-map-support`).
   - Keep the author, license and repository metadata on the root.
3. Move the shared `compilerOptions` into `tsconfig.base.json`. `packages/server/tsconfig.json` extends it and keeps `outDir`, `rootDir` and `types`.
4. Root scripts run across packages: `ts`, `lint`, `lint:fix`, `format`, `test`, `test:cov`, `test:e2e`, `build`. `build` and `ts` use `yarn workspaces foreach -Apt run <script>` (topological, so later packages build in dependency order). `test` and `test:cov` run the root Vitest config with its projects. `lint` and `format` run ESLint once from the root over `packages/`.
5. **Runtime files at the root.** `yarn start`, `yarn start:dev`, `yarn start:debug` and `yarn start:prod` run from the root and must keep the process working directory at the repository root, because `.env` (`dotenv/config`), `data/` and `workspaces/` resolve from `process.cwd()`. Suggested approach: root scripts call the Nest CLI with `--config packages/server/nest-cli.json` and a `nest-cli.json` whose `sourceRoot` and `compilerOptions.tsConfigPath` point into `packages/server`. If the Nest CLI cannot do that, find another way that keeps the working directory at the root. Do not change how the code resolves paths.
6. ESLint: point `eslint-import-resolver-typescript` at `packages/*/tsconfig.json` and update `globalIgnores` (`packages/*/dist/`, `packages/*/coverage/`).
7. `.gitignore`: add `packages/*/dist`, `packages/*/coverage` and `*.tsbuildinfo` in packages; keep `/data` and `/workspaces` at the root.
8. `yarn install` and commit the updated `yarn.lock`.
9. `.vscode/settings.json` and `.claude/` need no change; check that nothing else references `src/` from the root (`grep -rn "\"src/\|'src/\| src/" --exclude-dir=node_modules --exclude-dir=packages`), except docs, which plan 02 updates.

## Acceptance

- `yarn ts`, `yarn lint`, `yarn test` and `yarn test:e2e` pass from the root with the same test count as before the move.
- `yarn build` produces `packages/server/dist/main.js`.
- `yarn start:dev` from the root boots, reads the root `.env` and uses the root `data/` and `workspaces/`.
- `git log --follow packages/server/src/main.ts` shows the file's earlier history.

## Out of scope

Dockerfile, GitHub workflows, README, `AGENTS.md` and skills (plan 02). New packages (plans 03 and 06).

## Commit

`build: convert the repository into a monorepo`
