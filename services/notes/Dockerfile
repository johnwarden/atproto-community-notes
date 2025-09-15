# Multi-stage Docker build optimized for layer caching
# Layers ordered from least-likely-to-change to most-likely-to-change

FROM node:20.11-alpine as build

# Layer 1: System dependencies (most stable - changes very rarely)
RUN apk add --no-cache python3 make g++ sqlite-dev
RUN corepack enable
WORKDIR /app

# Layer 2: Workspace configuration (very stable)
COPY ./pnpm-workspace.yaml ./
# Copy .npmrc if it exists
COPY .npmrc* ./

# Layer 3: Package manifests only (moderately stable - changes when adding/updating deps)
COPY ./package.json ./pnpm-lock.yaml ./
COPY ./packages/notes/package.json ./packages/notes/package.json
COPY ./services/notes/package.json ./services/notes/package.json

# Layer 4: Prepare package manager (depends on package.json)
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate

# Layer 5: Install dependencies (expensive operation - cache when possible)
RUN pnpm install --frozen-lockfile

# Layer 6: TypeScript configuration (rarely changes)
COPY ./tsconfig ./tsconfig
COPY ./packages/notes/tsconfig*.json ./packages/notes/

# Layer 7: Source code (changes frequently - comes LAST for optimal caching)
COPY ./packages/notes/src ./packages/notes/src
COPY ./services/notes ./services/notes

# Layer 8: Build application (only runs when source code or config changes)
RUN pnpm build

# Layer 9: Production dependencies setup (only when package.json changes)
RUN rm -rf node_modules
RUN pnpm install --prod --shamefully-hoist --frozen-lockfile --prefer-offline

# Layer 9b: Approve and rebuild better-sqlite3 for production
#RUN echo "better-sqlite3" | pnpm approve-builds --stdin || true
#RUN pnpm rebuild better-sqlite3

WORKDIR services/notes

# Runtime stage - optimized for minimal size
FROM node:20.11-alpine

# Runtime dependencies (including FUSE for LiteFS)
RUN apk add --no-cache dumb-init curl ca-certificates fuse3 sqlite

# Install LiteFS using the official Fly.io method
COPY --from=flyio/litefs:0.5 /usr/local/bin/litefs /usr/local/bin/litefs

# Create directories for LiteFS
RUN mkdir -p /var/lib/litefs /litefs

# Avoid zombie processes, handle signal forwarding
ENTRYPOINT ["dumb-init", "--"]

WORKDIR /app/services/notes
COPY --from=build /app /app

EXPOSE 8080 8081
ENV PORT=8080
ENV INTERNAL_API_PORT=8081
ENV NODE_ENV=production

# LiteFS mounts database and executes Node.js app (configured in litefs.yml)
CMD ["litefs", "mount", "-config", "litefs.yml"]

LABEL org.opencontainers.image.source=https://github.com/johnwarden/atproto-community-notes
LABEL org.opencontainers.image.description="Community Notes Service"
LABEL org.opencontainers.image.licenses=MIT