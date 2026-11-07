# 08 — Integration and release

**Model:** Sonnet 5.5 · **Effort:** low · **Depends on:** 07

## Goal

Make the web interface buildable and runnable together with the server, then document it. The server and the web app are separate processes: the web app is served by Vite (`dev`, `preview`) locally and by nginx in production, and reaches the server through a same-origin `/ws` proxy.

## Read first

`Dockerfile`, `.dockerignore`, root `package.json`, `README.md`, `AGENTS.md`, `.env.example` and `packages/web/vite.config.ts`.

## Steps

1. **Build order:** root `yarn build` builds protocol → web → server; confirm it with a clean checkout (`git clean -xfd` on a copy, `yarn install`, `yarn build`).
2. **Runtime imports:** the server imports `@agent-remote-control/protocol` at runtime from `packages/protocol/dist`. Confirm that `yarn start:prod` works after `yarn build`.
3. **Dockerfile (server image):**
   - `build` runs the root `yarn build`.
   - `runner` copies `packages/protocol/{package.json,dist}` and the server files. The web build is not part of the server image.
   - Confirm that `yarn workspaces focus --production @agent-remote-control/server` installs the protocol link and `zod`.
4. **Docker networking:** the access token is printed in the container log. Document `docker logs <container>` to retrieve it, and that the port published by Docker is protected by the token and the origin check.
5. **nginx example:** document in the README a minimal nginx server block that serves `packages/web/dist` with an SPA fallback (`try_files $uri /index.html`) and proxies `/ws` (with the `Upgrade` and `Connection` headers and `proxy_set_header Host $host`) and `/health` to the server. Check the same flow locally with `vite preview`.
6. **README:**
   - A "Web interface" section after the Quick Start covering: starting the server, copying the token from the log, development with `yarn dev:web`, `vite preview`, the nginx example and the env vars (`WEB_ENABLED`, `WEB_ACCESS_TOKEN`, `WEB_ALLOWED_ORIGINS`).
   - Make Discord optional in the Quick Start: `DISCORD_BOT_TOKEN` is needed only for the bot.
   - Keep the existing security warning and extend it to the web token.
7. **`AGENTS.md`:** structure tree with the three packages, and the essential commands including `yarn dev:web`.
8. **Roadmap:** mark Stage 1 as done in `docs/ROADMAP.md`.
9. **Visual check:** run the built app with `vite preview`, take a phone-width and a desktop-width screenshot of a conversation with a finished turn, and attach them to the pull request.

## Acceptance

- `yarn ts`, `yarn lint`, `yarn test`, `yarn test:e2e` and `yarn build` pass.
- `docker build .` succeeds. A container started with `-p 3000:3000` logs the access token, and the web app served by `vite preview` runs a conversation end to end through it with an agent available in the image (Codex, or Claude Code through `ARC_AGENTS`).

## Commits

- `build: ship the web interface with the server`
- `docs: document the web interface`
