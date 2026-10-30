# Production Dockerfile

FROM node:24-bookworm-slim AS base
WORKDIR /app

# Installs every dependency required for the build
FROM base AS deps
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN yarn install --immutable --mode=skip-build

# Compiles the backend with the installed dependencies
FROM base AS build
COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN yarn build

# Installs only the production dependencies
FROM base AS prod-deps
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN yarn workspaces focus --production

# Final stage that runs the application. Claude Code and Codex come with the application
# dependencies; Copilot, Cursor and Antigravity are installed at startup by the entrypoint
# according to ARC_AGENTS. Cursor and Antigravity ship glibc binaries, hence a Debian base.
FROM base AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git gh openssh-client \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  PORT=3000 \
  DATA_DIR=/app/data \
  WORKSPACE_DIR=/app/workspaces \
  NPM_CONFIG_PREFIX=/home/node/.local \
  PATH=/home/node/.local/bin:/app/node_modules/.bin:$PATH

COPY --chown=node:node --from=prod-deps /app/package.json /app/yarn.lock /app/.yarnrc.yml ./
COPY --chown=node:node --from=prod-deps /app/.yarn ./.yarn
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN ln -s /app/node_modules/@anthropic-ai/claude-agent-sdk-linux-*/claude /usr/local/bin/claude \
  && chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p "$DATA_DIR" "$WORKSPACE_DIR" /home/node/.local/bin \
  && chown -R node:node "$DATA_DIR" "$WORKSPACE_DIR" /home/node

USER node

VOLUME ["/app/data", "/app/workspaces"]
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main"]
