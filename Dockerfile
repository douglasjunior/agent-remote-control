# Production Dockerfile

FROM node:24-bookworm-slim AS base
WORKDIR /app

# Installs every dependency required for the build
FROM base AS deps
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY packages/web/package.json ./packages/web/package.json
RUN pnpm install --frozen-lockfile

# Compiles the protocol and the server with the installed dependencies; the web app is not part of the image
FROM base AS build
RUN corepack enable
COPY . .
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/protocol/node_modules ./packages/protocol/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
RUN pnpm --filter @agent-remote-control/server... build

# Extracts the server with only its production dependencies into a self-contained directory
FROM build AS prod-deps
RUN pnpm --filter @agent-remote-control/server deploy --prod /deploy

# Builds the whisper.cpp CLI (CPU speech-to-text) as a self-contained binary. GGML_NATIVE=OFF keeps
# the build from targeting the CPU of the machine that builds the image, which would crash with
# SIGILL on hosts lacking those instructions.
FROM base AS whisper
ARG WHISPER_CPP_VERSION=v1.7.6
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$WHISPER_CPP_VERSION" https://github.com/ggml-org/whisper.cpp /whisper \
  && cd /whisper \
  && cmake -B build -DGGML_NATIVE=OFF -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
  && cmake --build build --config Release -j --target whisper-cli

# Final stage that runs the application. Codex comes with the application dependencies; Claude
# Code (linked from the SDK binary), Copilot, Cursor, Antigravity and OpenCode are made available at startup
# by the entrypoint according to ARC_AGENTS. Cursor and Antigravity ship glibc binaries, hence
# a Debian base.
FROM base AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg git gh openssh-client \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  PORT=3000 \
  DATA_DIR=/app/data \
  WORKSPACE_DIR=/app/workspaces \
  PATH=/home/node/.local/bin:/app/node_modules/.bin:/app/node_modules/.pnpm/node_modules/.bin:$PATH

COPY --chown=node:node --from=prod-deps /deploy/node_modules ./node_modules
COPY --chown=node:node --from=prod-deps /deploy/package.json ./packages/server/package.json
COPY --chown=node:node --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=whisper /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p "$DATA_DIR" "$WORKSPACE_DIR" /home/node/.local/bin \
  && chown -R node:node "$DATA_DIR" "$WORKSPACE_DIR" /home/node

USER node

VOLUME ["/app/data", "/app/workspaces"]
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "packages/server/dist/main"]
