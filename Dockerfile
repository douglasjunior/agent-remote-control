# Production Dockerfile

FROM node:24-alpine AS base
WORKDIR /app

# Runtime image with the system tools required in production
FROM base AS runtime-base
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash

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

# Final stage that runs the application
FROM runtime-base AS runner
COPY --from=deps /app/package.json ./
COPY --from=deps /app/yarn.lock ./
COPY --from=deps /app/.yarn ./.yarn
COPY --from=deps /app/.yarnrc.yml ./.yarnrc.yml
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# ENV OTEL_SERVICE_NAME="agent-remote-control"
# ENV OTEL_METRICS_EXPORTER="otlp"
# ENV OTEL_TRACES_EXPORTER="otlp"
# ENV OTEL_LOGS_EXPORTER="otlp"
# ENV OTEL_EXPORTER_OTLP_PROTOCOL="grpc"
# ENV OTEL_NODE_RESOURCE_DETECTORS="all"
# ENV NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"

CMD ["yarn", "start:prod"]
