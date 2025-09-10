FROM node:20.11-alpine as build

RUN corepack enable

WORKDIR /app

COPY ./package.json ./
RUN corepack prepare --activate

# Move files into the image and install
COPY ./*.* ./
# NOTE notes's transitive dependencies go here: if that changes, this needs to be updated.
COPY ./tsconfig ./tsconfig
COPY ./packages/notes ./packages/notes
COPY ./packages/api ./packages/api
COPY ./packages/common ./packages/common
COPY ./packages/common-web ./packages/common-web
COPY ./packages/lexicon ./packages/lexicon
COPY ./packages/syntax ./packages/syntax
COPY ./packages/xrpc-server ./packages/xrpc-server
COPY ./services/notes ./services/notes

# install all deps
RUN pnpm install --frozen-lockfile > /dev/null
# build all packages with external node_modules
RUN pnpm build > /dev/null
# clean up
RUN rm -rf node_modules
# install only prod deps, hoisted to root node_modules dir
RUN pnpm install --prod --shamefully-hoist --frozen-lockfile --prefer-offline > /dev/null

WORKDIR services/notes

# Uses assets from build stage to reduce build size
FROM node:20.11-alpine

RUN apk add --update dumb-init curl ca-certificates fuse3

# Install LiteFS
RUN curl -L https://github.com/superfly/litefs/releases/latest/download/litefs-linux-amd64.tar.gz | tar xz -C /tmp
RUN mv /tmp/litefs /usr/local/bin/

# Create directories for LiteFS
RUN mkdir -p /var/lib/litefs /litefs

# Avoid zombie processes, handle signal forwarding
ENTRYPOINT ["dumb-init", "--"]

WORKDIR /app/services/notes
COPY --from=build /app /app
COPY litefs.yml /app/services/notes/

EXPOSE 8081
ENV PORT=8081
ENV NODE_ENV=production

# LiteFS mounts database, Node.js app handles HTTP directly
# No proxy needed - LiteFS just provides shared database access
CMD ["litefs", "mount", "-config", "litefs.yml", "-exec", "node --heapsnapshot-signal=SIGUSR2 --enable-source-maps index.js"]

LABEL org.opencontainers.image.source=https://github.com/johnwarden/atproto-community-notes
LABEL org.opencontainers.image.description="Community Notes Service"
LABEL org.opencontainers.image.licenses=MIT
