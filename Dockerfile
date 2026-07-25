# GlassBox402 — one container: the hub (public port) plus every x402 gateway
# from lanes.json on loopback behind it. core/src/serve.ts supervises the tree.

FROM node:22-bookworm-slim

# Pinned rather than `corepack enable`: node 22 ships corepack defaulting to
# pnpm 9, which — unlike 10 — runs dependency build scripts. pnpm-lock.yaml was
# produced by 10.33.0, so match it and keep installs identical to local.
RUN npm install -g pnpm@10.33.0

WORKDIR /app

# Manifests first so the install layer caches until a dependency actually
# changes. packages/x402ify is deliberately absent: it isn't a workspace member
# (see pnpm-workspace.yaml), carries its own npm lockfile, and nothing at
# runtime imports it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY core/package.json core/package.json
COPY lens/package.json lens/package.json
RUN pnpm install --frozen-lockfile

COPY core core
COPY lens lens
COPY lanes.json ./

# The bundle talks to its own origin, so there is nothing environment-specific
# baked in here — the same dist works on any hostname.
# Root is positional here; `--root lens` is not a valid `vite build` flag and
# fails with "Unknown option".
RUN lens/node_modules/.bin/vite build lens

ENV NODE_ENV=production
# No pnpm prune / --prod: tsx and vite are devDependencies and the runtime needs
# tsx. Image size is not the constraint here.
CMD ["core/node_modules/.bin/tsx", "core/src/serve.ts"]
