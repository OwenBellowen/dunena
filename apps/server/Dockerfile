FROM oven/bun:1 AS base
WORKDIR /app

# Install workspace dependencies
COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
COPY zig ./zig
COPY tsconfig.base.json ./
COPY bunfig.toml ./
RUN bun install --frozen-lockfile

# Build Zig native library for linux target
RUN cd zig && zig build -Doptimize=ReleaseFast

# Runtime image
FROM oven/bun:1-slim AS runtime
WORKDIR /app

COPY --from=base /app /app
ENV NODE_ENV=production
ENV DUNENA_HOST=0.0.0.0
ENV DUNENA_PORT=3000

EXPOSE 3000
CMD ["bun", "run", "--cwd", "apps/server", "start"]
