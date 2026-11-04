# 02 — Monorepo: Docker, CI and docs

**Model:** Sonnet 5.5 · **Effort:** low · **Depends on:** 01

## Goal

Bring everything that references the old single-package layout in line with the monorepo, and add a pull request CI workflow. This gives the later plans, and the smaller models that run them, an automatic safety net.

## Read first

`Dockerfile`, `.dockerignore`, `docker-entrypoint.sh`, `.github/workflows/publish.yml`, `AGENTS.md`, `README.md`, and every `.agents/skills/*/SKILL.md` that mentions `src/` (`grep -rln "src/" .agents/skills`). Read `.agents/skills/skill-authoring/SKILL.md` before editing a skill.

## Steps

1. **Dockerfile**
   - `deps`: copy the root `package.json`, `yarn.lock`, `.yarnrc.yml`, `.yarn` **and every `packages/*/package.json`** before `yarn install --immutable --mode=skip-build`, so the install layer stays cached.
   - `build`: `yarn build` from the root.
   - `prod-deps`: `yarn workspaces focus --production @agent-remote-control/server`.
   - `runner`: copy `packages/server/dist` and `packages/server/package.json` into the same relative paths under `/app`. Keep `WORKDIR /app` so `/app/data` and `/app/workspaces` still apply. Set `CMD ["node", "packages/server/dist/main"]`.
   - Keep the image layout extensible: plan 08 adds `packages/protocol/dist` and `packages/web/dist`.
2. **`.dockerignore`:** change `dist`, `coverage` and `test` to globs that match inside packages (`**/dist`, `**/coverage`, `packages/*/test`).
3. **`docker-entrypoint.sh`:** check for paths such as `/app/node_modules/.bin` and `dist/main`; adjust only if they changed.
4. **New `.github/workflows/ci.yml`:** on `pull_request` and on `push` to `main`, Node 24, `corepack enable`, `yarn install --immutable`, then `yarn ts`, `yarn lint`, `yarn test` and `yarn test:e2e`. Cache with `actions/setup-node` `cache: yarn`.
5. **`publish.yml`:** the Docker build context stays `.`; confirm nothing else needs changing.
6. **`AGENTS.md`:** update the repository structure tree (root files, `packages/server/src/...`) and the essential commands, and state that the commands run from the root. Describe the current state only (see "Writing Comments and Documentation").
7. **README:** update the Quick Start and Contributing paths and commands. Behavior is unchanged, so no feature text changes.
8. **Skills:** replace `src/...` paths with `packages/server/src/...` in every skill that cites them. `clean-architecture-nestjs` and `code-organization` gain one line stating that a package exposes files through subpath exports, never through an `index.ts`.

## Acceptance

- `docker build .` succeeds, and `docker run --rm -e DISCORD_BOT_TOKEN= -p 3000:3000 <image>` boots and answers `GET /` with `Hello World!`.
- `yarn ts`, `yarn lint` and `yarn test` pass.
- `grep -rn "src/" AGENTS.md README.md .agents/skills` only returns paths under `packages/`.
- The CI workflow runs green on the draft pull request of the roadmap branch.

## Out of scope

Any code change.

## Commits

- `build(docker): build the server from the monorepo`
- `ci: run type check, lint and tests on pull requests`
- `docs: update paths for the monorepo layout`
