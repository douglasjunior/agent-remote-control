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
RUN yarn workspaces focus --all --production

# Final stage that runs the application. The agent CLIs must be on the PATH of the container;
# Cursor and Antigravity ship glibc binaries, hence a Debian base instead of Alpine.
FROM base AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git gh openssh-client \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  PORT=3000 \
  DATA_DIR=/app/data \
  WORKSPACE_DIR=/app/workspaces \
  PATH=/home/node/.local/bin:/app/node_modules/.bin:$PATH

RUN mkdir -p "$DATA_DIR" "$WORKSPACE_DIR" && chown -R node:node /app /home/node

USER node

RUN npm config set prefix /home/node/.local \
  && npm install --global @github/copilot \
  && npm cache clean --force
RUN curl -fsSL https://cursor.com/install | bash
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash

COPY --chown=node:node --from=prod-deps /app/package.json /app/yarn.lock /app/.yarnrc.yml ./
COPY --chown=node:node --from=prod-deps /app/.yarn ./.yarn
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist

# Claude Code and Codex reuse the binaries that ship with the application dependencies
RUN ln -s /app/node_modules/@anthropic-ai/claude-agent-sdk-linux-*/claude /home/node/.local/bin/claude

VOLUME ["/app/data", "/app/workspaces"]
EXPOSE 3000

CMD ["node", "dist/main"]
