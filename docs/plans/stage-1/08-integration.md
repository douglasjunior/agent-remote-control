# 08 — Integration and release

**Model:** Sonnet 5.5 · **Effort:** low · **Depends on:** 07

## Goal

Ship the web interface with the server: one build, one process, one port, in development, in production and in the Docker image. Then document it.

## Read first

`Dockerfile`, `.dockerignore`, root `package.json`, `README.md`, `AGENTS.md`, `.env.example`, and `packages/server/src/modules/web/web.module.ts` (static serving).

## Steps

1. **Build order:** root `yarn build` builds protocol → web → server; confirm it with a clean checkout (`git clean -xfd` on a copy, `yarn install`, `yarn build`).
2. **Runtime imports:** the server imports `@agent-remote-control/protocol` at runtime from `packages/protocol/dist`. Confirm that `yarn start:prod` works after `yarn build`.
3. **Dockerfile:**
   - `build` runs the root `yarn build`.
   - `runner` copies `packages/protocol/{package.json,dist}`, `packages/web/dist` and the server files.
   - Confirm that `yarn workspaces focus --production @agent-remote-control/server` installs the protocol link and `zod`.
   - The static module finds `packages/web/dist` from the default path; check this inside the container.
4. **Docker networking:** the token URL is printed in the container log. Document `docker logs <container>` to retrieve it, and that the port published by Docker is protected by the token.
5. **e2e:** with `WEB_DIST_DIR` pointing at a fixture directory containing an `index.html`, `GET /` and `GET /c/anything` return it (SPA fallback) and `GET /health` keeps answering.
6. **README:**
   - A "Web interface" section after the Quick Start covering: open the token link, what the interface offers, development with `yarn dev:web` plus `WEB_ALLOWED_ORIGINS`, and the env vars.
   - Make Discord optional in the Quick Start: `DISCORD_BOT_TOKEN` is needed only for the bot.
   - Keep the existing security warning and extend it to the web token.
7. **`AGENTS.md`:** structure tree with the three packages, and the essential commands including `yarn dev:web`.
8. **Roadmap:** mark Stage 1 as done in `docs/ROADMAP.md`.
9. **Visual check:** run the built app, take a phone-width and a desktop-width screenshot of a conversation with a finished turn, and attach them to the pull request.

## Acceptance

- `yarn ts`, `yarn lint`, `yarn test`, `yarn test:e2e` and `yarn build` pass.
- `docker build .` succeeds. A container started with `-p 3000:3000` serves the interface at the logged token URL, and a conversation runs end to end with an agent available in the image (Codex, or Claude Code through `ARC_AGENTS`).

## Commits

- `build: ship the web interface with the server`
- `docs: document the web interface`
