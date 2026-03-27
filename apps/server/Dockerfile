FROM oven/bun:1 AS base
WORKDIR /app

# Install Zig (required for building native modules)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    xz-utils \
    && curl -fsSL https://ziglang.org/download/0.14.0/zig-linux-x86_64-0.14.0.tar.xz | tar -xJ -C /usr/local \
    && ln -s /usr/local/zig-linux-x86_64-0.14.0/zig /usr/local/bin/zig \
    && apt-get purge -y curl xz-utils \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Install workspace dependencies
COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
COPY zig ./zig
COPY tsconfig.base.json ./
COPY bunfig.toml ./
RUN bun install --frozen-lockfile

# Build Zig native library for linux target (ReleaseSafe = bounds checks + overflow traps)
RUN cd zig && zig build -Doptimize=ReleaseSafe

# Runtime image
FROM oven/bun:1-slim AS runtime
WORKDIR /app

COPY --from=base /app /app
ENV NODE_ENV=production
ENV DUNENA_HOST=0.0.0.0
ENV DUNENA_PORT=3000

EXPOSE 3000
CMD ["bun", "run", "--cwd", "apps/server", "start"]
