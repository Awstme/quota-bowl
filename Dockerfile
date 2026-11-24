FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server/ ./server/
COPY web/ ./web/
RUN npm run build

FROM node:24-trixie-slim
WORKDIR /app
ENV NODE_ENV=production QUOTA_DB=/data/quota.sqlite QUOTA_BIND_HOST=0.0.0.0 QUOTA_PORT=5555
ARG TARGETARCH
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) arch=x86_64; sha256=adaa5c7b4e09e26b135e5b958705a746189b289ade7fc3c26b1d0538259572a5 ;; \
      arm64) arch=aarch64; sha256=209d475d23e676f463590c9f304c58c0673b924ef618c58bc4629dee79e420b5 ;; \
      *) echo "Unsupported CodexBar architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl libsqlite3-0; \
    rm -rf /var/lib/apt/lists/*; \
    archive="CodexBarCLI-v0.85.0-linux-$arch.tar.gz"; \
    curl -fsSL --retry 3 "https://github.com/steipete/CodexBar/releases/download/v0.85.0/$archive" -o "/tmp/$archive"; \
    printf '%s  %s\n' "$sha256" "/tmp/$archive" | sha256sum -c -; \
    mkdir -p /opt/codexbar; \
    tar -xzf "/tmp/$archive" -C /opt/codexbar; \
    rm "/tmp/$archive"; \
    ln -s /opt/codexbar/codexbar /usr/local/bin/codexbar; \
    install -d -m 0700 -o node -g node /data
COPY package.json ./
COPY --from=build /app/dist/server/ ./dist/server/
COPY --from=build /app/web/dist/ ./web/dist/
USER node
RUN codexbar --version
EXPOSE 5555
CMD ["node", "dist/server/entrypoints/app/main.js"]
