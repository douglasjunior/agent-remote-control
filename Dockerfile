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

# Builds the whisper.cpp CLI (CPU speech-to-text) as a self-contained binary
FROM base AS whisper
ARG WHISPER_CPP_VERSION=v1.7.6
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$WHISPER_CPP_VERSION" https://github.com/ggml-org/whisper.cpp /whisper \
  && cd /whisper \
  && cmake -B build -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
  && cmake --build build --config Release -j --target whisper-cli

# Final stage that runs the application. Codex comes with the application dependencies; Claude
# Code (linked from the SDK binary), Copilot, Cursor and Antigravity are made available at startup
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
  NPM_CONFIG_PREFIX=/home/node/.local \
  PATH=/home/node/.local/bin:/app/node_modules/.bin:$PATH

COPY --chown=node:node --from=prod-deps /app/package.json /app/yarn.lock /app/.yarnrc.yml ./
COPY --chown=node:node --from=prod-deps /app/.yarn ./.yarn
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --from=whisper /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p "$DATA_DIR" "$WORKSPACE_DIR" /home/node/.local/bin \
  && chown -R node:node "$DATA_DIR" "$WORKSPACE_DIR" /home/node

USER node

VOLUME ["/app/data", "/app/workspaces"]
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main"]
